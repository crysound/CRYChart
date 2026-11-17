import { createHash } from "node:crypto";

export const callable = (entry) =>
  !["type", "abstract", "value", "property"].includes(entry.kind);
export const publicValue = (entry) =>
  ["value", "property"].includes(entry.kind);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const stable = (value) => JSON.stringify(value);
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function uncoveredUpdateApis(previous, current) {
  const before = new Map(previous.entries.map((entry) => [entry.id, entry]));
  return current.entries
    .filter(
      (entry) =>
        (callable(entry) || publicValue(entry)) &&
        entry.status === "missing" &&
        before.get(entry.id)?.status !== "missing",
    )
    .map((entry) => entry.id);
}

export function makeManifest(discovery, policy) {
  const scenarios = Object.fromEntries(
    discovery.scenarios.map((s) => [
      s.id,
      {
        file: s.file,
        name: s.name,
        dynamic: s.dynamic,
        explicit: s.explicit,
        assertions: s.assertions.map((a) => ({
          file: a.file,
          expression: a.expression,
        })),
      },
    ]),
  );
  const entries = discovery.entries.map((e) => ({
    id: e.id,
    kind: e.kind,
    source: e.file,
    paths: e.paths,
    signature: digest(e.signature),
    status: e.placeholder
      ? "placeholder"
      : ["type", "abstract"].includes(e.kind)
        ? "type-only"
        : e.scenarios.length
          ? "mapped"
          : "missing",
    ...(e.placeholder
      ? { limitation: policy.placeholders[e.id] ?? "REVIEW REQUIRED" }
      : {}),
    ...(policy.limitations?.[e.id]
      ? { limitation: policy.limitations[e.id] }
      : {}),
    scenarios: e.scenarios,
  }));
  return { schemaVersion: 1, scope: discovery.scope, entries, scenarios };
}

export function validateManifest(
  discovery,
  manifest,
  policy,
  run,
  results,
  fingerprint,
) {
  const errors = [];
  const current = makeManifest(discovery, policy);
  const titles = new Map();
  for (const scenario of Object.values(current.scenarios)) {
    const previous = titles.get(scenario.name);
    if (previous && (previous.explicit || scenario.explicit))
      errors.push(
        `Ambiguous explicitly bound scenario title: ${scenario.name}`,
      );
    titles.set(scenario.name, scenario);
  }
  const saved = new Map(manifest.entries.map((e) => [e.id, e]));
  const available = new Map(current.entries.map((e) => [e.id, e]));
  if (saved.size !== manifest.entries.length)
    errors.push("Duplicate API IDs in the committed mapping");
  for (const entry of current.entries) {
    const previous = saved.get(entry.id);
    if (!previous) errors.push(`Unregistered public API: ${entry.id}`);
    else if (
      previous.kind !== entry.kind ||
      previous.source !== entry.source ||
      previous.signature !== entry.signature ||
      stable(previous.paths) !== stable(entry.paths)
    )
      errors.push(
        `Changed API declaration: ${entry.id}; review and update the mapping`,
      );
    if (
      entry.status === "placeholder" &&
      (!policy.placeholders[entry.id] || previous?.status !== "placeholder")
    )
      errors.push(`Unreviewed placeholder: ${entry.id}`);
    if (previous?.status === "mapped") {
      if (entry.status !== "mapped")
        errors.push(`API lost its assertion mapping: ${entry.id}`);
      for (const id of previous.scenarios) {
        const scenario = current.scenarios[id],
          old = manifest.scenarios[id];
        if (!scenario || !old || !entry.scenarios.includes(id))
          errors.push(`Missing test scenario for ${entry.id}: ${id}`);
        else if (
          !old.assertions.length ||
          old.assertions.some(
            (a) => !scenario.assertions.some((b) => stable(a) === stable(b)),
          )
        )
          errors.push(`Removed/changed assertion for ${entry.id}: ${id}`);
      }
    }
  }
  for (const entry of manifest.entries)
    if (!available.has(entry.id))
      errors.push(`Removed public API: ${entry.id}; review the mapping`);
  for (const id of Object.keys(policy.placeholders))
    if (!available.get(id) || available.get(id).status !== "placeholder")
      errors.push(`Stale placeholder classification: ${id}`);
  for (const id of policy.requiredApis)
    if (available.get(id)?.status !== "mapped")
      errors.push(`Required API has no asserted scenario: ${id}`);
  for (const prefix of policy.requiredOwners ?? [])
    for (const entry of current.entries) {
      if (
        entry.id.startsWith(prefix + ".") &&
        callable(entry) &&
        !entry.status.includes("placeholder") &&
        entry.status !== "mapped"
      )
        errors.push(`Priority API has no asserted scenario: ${entry.id}`);
    }
  const previousMissing = manifest.entries.filter(
    (e) => callable(e) && e.status === "missing",
  ).length;
  const missing = current.entries.filter(
    (e) => callable(e) && e.status === "missing",
  ).length;
  if (policy.requireAllCallable && missing)
    errors.push(`Callable APIs require asserted scenarios: ${missing} missing`);
  const unassertedValues = current.entries.filter(
    (entry) => publicValue(entry) && entry.status === "missing",
  );
  if (policy.requireAllValues && unassertedValues.length)
    errors.push(
      `Public fields and constants require asserted scenarios: ${unassertedValues.map((entry) => entry.id).join(", ")}`,
    );
  if (missing > previousMissing)
    errors.push(
      `Unmapped callable APIs increased: ${previousMissing} -> ${missing}`,
    );
  if (!run?.complete || run.fingerprint !== fingerprint)
    errors.push(
      "Missing, failed or stale test run; run npm run test:coverage first",
    );
  if (
    !results.length ||
    results.some((r) => r.status === "failed" && !r.skipped && !r.todo)
  )
    errors.push("Test results are absent or contain failures");
  const matchingResult = (scenario) => {
    const pattern = scenario.dynamic
      ? new RegExp(
          "^" +
            scenario.name
              .split(/\$\{[^}]+\}/)
              .map(escape)
              .join(".+") +
            "$",
        )
      : undefined;
    return results.some(
      (r) =>
        r.status === "passed" &&
        !r.skipped &&
        !r.todo &&
        (pattern ? pattern.test(r.name) : r.name === scenario.name) &&
        (r.file?.replaceAll("\\", "/").endsWith("/" + scenario.file) ||
          (scenario.explicit &&
            r.file
              ?.replaceAll("\\", "/")
              .endsWith("/tests/helpers/api-test.ts"))),
    );
  };
  for (const [id, scenario] of Object.entries(manifest.scenarios)) {
    if (!matchingResult(scenario))
      errors.push(`Scenario did not pass in this run: ${id}`);
  }
  return {
    errors: [...new Set(errors)],
    current,
    summary: {
      publicEntries: current.entries.length,
      callable: current.entries.filter(callable).length,
      mappedCallable: current.entries.filter(
        (e) => callable(e) && e.status === "mapped",
      ).length,
      missingCallable: missing,
      placeholders: current.entries.filter((e) => e.status === "placeholder")
        .length,
      types: current.entries.filter((e) => e.kind === "type").length,
      publicValues: current.entries.filter(publicValue).length,
      mappedValues: current.entries.filter(
        (entry) => publicValue(entry) && entry.status === "mapped",
      ).length,
      unassertedValues: unassertedValues.length,
      mappedScenarios: Object.keys(manifest.scenarios).length,
    },
  };
}

export function renderReport(discovery, manifest, summary, rootPrefix = "..") {
  const rows = [
    "# 公开 API、功能场景与测试断言",
    "",
    "此清单覆盖两个包入口的公开导出、继承方法、工厂返回方法及属性，包括构造函数中赋值的 engine 对象。`mapped` 表示静态调用/字段引用（或显式绑定）及断言可追溯；实际通过状态由本轮 test:api 报告核验，不表示所有参数组合或 UI 行为均已验收。`missing` 是缺口，不计为通过。CI 对非占位的可调用接口、公开字段和常量均执行零缺口门禁；占位接口继续单独标记。类型与抽象声明通过类型检查验证，不计入运行时功能测试比例。publicValues、mappedValues 和 unassertedValues 分别统计公开值总数、有场景映射及缺失映射的数量。",
    "",
    "| 统计 | 数量 |",
    "|---|---:|",
  ];
  for (const [key, value] of Object.entries(summary))
    rows.push(`| ${key} | ${value} |`);
  rows.push(
    "",
    "| API | 状态 | 公开路径 | 功能场景 / 测试断言 |",
    "|---|---|---|---|",
  );
  const source = new Map(discovery.entries.map((e) => [e.id, e]));
  for (const entry of manifest.entries) {
    const e = source.get(entry.id),
      paths = entry.paths.join("<br>");
    const links = entry.scenarios
      .slice(0, 3)
      .map((id) => {
        const scenario = discovery.scenarios.find((s) => s.id === id);
        if (!scenario) return id;
        return `[${scenario.name.replaceAll("|", "\\|")}](${rootPrefix + "/" + scenario.file}#L${scenario.line}) — ${scenario.assertions.length} 个断言`;
      })
      .join("<br>");
    rows.push(
      `| [\`${entry.id}\`](${rootPrefix + "/" + entry.source}#L${e?.line ?? 1}) | ${entry.status} | ${paths} | ${links || (["type", "abstract"].includes(entry.kind) ? "仅类型/抽象声明；通过类型检查验证" : entry.limitation ? "" : "待补功能场景及断言")}${entry.limitation ? `${links ? "<br>" : ""}限制：${entry.limitation}` : ""}${entry.scenarios.length > 3 ? `<br>另有 ${entry.scenarios.length - 3} 个场景，见 JSON 清单` : ""} |`,
    );
  }
  return rows.join("\n") + "\n";
}
