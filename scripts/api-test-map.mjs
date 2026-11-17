import ts from "typescript";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const slash = (value) => value.replaceAll("\\", "/");
const normalize = (text) => text.replace(/\s+/g, " ").trim();
const hash = (text) => createHash("sha256").update(text).digest("hex");
const privateMember = (node) =>
  node.modifiers?.some((m) =>
    [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword].includes(
      m.kind,
    ),
  ) ||
  (node.name && ts.isPrivateIdentifier(node.name));
const walk = (node, visit) => {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
};

export function analyzeApiTests(projectRoot = root) {
  const configFile = ts.readConfigFile(
    resolve(projectRoot, "tsconfig.json"),
    ts.sys.readFile,
  );
  const config = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    projectRoot,
  );
  const tests = readdirSync(resolve(projectRoot, "tests"))
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => resolve(projectRoot, "tests", name));
  const program = ts.createProgram(
    [...config.fileNames, ...tests],
    config.options,
  );
  const checker = program.getTypeChecker();
  const entries = new Map(),
    declarationIds = new Map(),
    scenarios = new Map();
  const rel = (file) => slash(relative(projectRoot, file));
  const location = (node) => ({
    file: rel(node.getSourceFile().fileName),
    line:
      node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line +
      1,
  });
  const key = (node) => `${node.getSourceFile().fileName}:${node.pos}`;
  const runtimeFile = (node) =>
    rel(node.getSourceFile().fileName).startsWith("src/");
  const symbolTarget = (symbol) =>
    symbol?.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;

  function register(id, kind, node, path, signature) {
    const original = declarationIds.get(key(node));
    if (original) {
      entries.get(original).paths.add(path);
      return original;
    }
    if (entries.has(id))
      throw new Error(`Ambiguous public API identity: ${id}`);
    const body = node.body;
    const statements = body && ts.isBlock(body) ? body.statements : [];
    const noOp =
      kind !== "constructor" &&
      body &&
      ts.isBlock(body) &&
      (statements.length === 0 ||
        (statements.length === 1 &&
          ts.isReturnStatement(statements[0]) &&
          statements[0].expression?.kind === ts.SyntaxKind.ThisKeyword));
    const entry = {
      id,
      kind,
      ...location(node),
      signature: normalize(signature),
      paths: new Set([path]),
      placeholder: !!noOp,
      scenarios: new Set(),
    };
    entries.set(id, entry);
    declarationIds.set(key(node), id);
    return id;
  }

  const visitedTypes = new Set();
  const containsMethods = (object) =>
    object.properties.some(
      (property) =>
        ts.isMethodDeclaration(property) ||
        (ts.isPropertyAssignment(property) &&
          (checker.getSignaturesOfType(
            checker.getTypeAtLocation(property.initializer),
            ts.SignatureKind.Call,
          ).length > 0 ||
            (ts.isObjectLiteralExpression(property.initializer) &&
              containsMethods(property.initializer)))),
    );
  function members(type, publicPath, ownerPath = publicPath) {
    // Inspect exported instances and factory return objects, never library/DOM types.
    const identity = `${type.id}:${publicPath}`;
    if (visitedTypes.has(identity)) return;
    visitedTypes.add(identity);
    for (const symbol of checker.getPropertiesOfType(type)) {
      const declarations = (symbol.declarations ?? []).filter(
        (node) => runtimeFile(node) && !privateMember(node),
      );
      const decl =
        declarations.find(
          (node) => ts.isMethodDeclaration(node) && node.body,
        ) ?? declarations[0];
      if (!decl) continue;
      const path = `${publicPath}.${symbol.name}`;
      if (
        ts.isMethodDeclaration(decl) ||
        ts.isGetAccessor(decl) ||
        ts.isSetAccessor(decl)
      ) {
        const owner = decl.parent.name?.text ?? ownerPath;
        register(
          `${owner}.${symbol.name}`,
          ts.isMethodDeclaration(decl)
            ? decl.body
              ? "method"
              : "abstract"
            : "accessor",
          decl,
          path,
          checker.typeToString(
            checker.getTypeOfSymbolAtLocation(symbol, decl),
            decl,
            ts.TypeFormatFlags.NoTruncation,
          ),
        );
      } else if (
        ts.isPropertyAssignment(decl) ||
        ts.isPropertyDeclaration(decl)
      ) {
        const value = decl.initializer;
        const valueType = checker.getTypeOfSymbolAtLocation(symbol, decl);
        const initializedCallback =
          value &&
          checker.getSignaturesOfType(valueType, ts.SignatureKind.Call).length >
            0;
        if (initializedCallback) {
          const owner = ts.isClassDeclaration(decl.parent)
            ? decl.parent.name?.text
            : ownerPath;
          register(
            `${owner}.${symbol.name}`,
            "factory-method",
            ts.isArrowFunction(value) || ts.isFunctionExpression(value)
              ? value
              : decl,
            path,
            checker.typeToString(
              checker.getTypeOfSymbolAtLocation(symbol, decl),
              decl,
              ts.TypeFormatFlags.NoTruncation,
            ),
          );
        } else {
          const owner = ts.isClassDeclaration(decl.parent)
            ? decl.parent.name?.text
            : ownerPath;
          register(
            `value:${owner}.${symbol.name}`,
            "property",
            decl,
            path,
            checker.typeToString(
              checker.getTypeOfSymbolAtLocation(symbol, decl),
              decl,
              ts.TypeFormatFlags.NoTruncation,
            ),
          );
        }
        // Public engine objects are sometimes declared `any` and assigned in
        // constructors. Their source-owned literal methods are still APIs.
        if (
          ts.isPropertyDeclaration(decl) &&
          ts.isClassDeclaration(decl.parent)
        ) {
          const objects = [];
          if (value && ts.isObjectLiteralExpression(value)) objects.push(value);
          for (const ctor of decl.parent.members.filter(
            ts.isConstructorDeclaration,
          )) {
            if (ctor.body)
              walk(ctor.body, (node) => {
                if (
                  ts.isBinaryExpression(node) &&
                  node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
                  ts.isPropertyAccessExpression(node.left) &&
                  node.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
                  node.left.name.text === symbol.name &&
                  ts.isObjectLiteralExpression(node.right)
                )
                  objects.push(node.right);
              });
          }
          for (const object of objects.filter(containsMethods))
            members(
              checker.getTypeAtLocation(object),
              path,
              `${decl.parent.name.text}.${symbol.name}`,
            );
        } else if (
          value &&
          ts.isObjectLiteralExpression(value) &&
          containsMethods(value)
        ) {
          members(
            checker.getTypeAtLocation(value),
            path,
            `${ownerPath}.${symbol.name}`,
          );
        }
      } else if (ts.isParameter(decl)) {
        const owner = decl.parent.parent.name?.text ?? publicPath;
        register(
          `value:${owner}.${symbol.name}`,
          "property",
          decl,
          path,
          checker.typeToString(
            checker.getTypeOfSymbolAtLocation(symbol, decl),
            decl,
            ts.TypeFormatFlags.NoTruncation,
          ),
        );
      }
    }
  }

  for (const [entrypoint, source] of [
    ["crychart", "src/index.ts"],
    ["crychart/themes", "src/themes.ts"],
  ]) {
    const sf = program.getSourceFile(resolve(projectRoot, source));
    for (const exported of checker.getExportsOfModule(
      checker.getSymbolAtLocation(sf),
    )) {
      const symbol = symbolTarget(exported),
        path = `${entrypoint}:${exported.name}`;
      const declarations = (symbol.declarations ?? []).filter(runtimeFile);
      const decl =
        declarations.find(
          (node) => ts.isFunctionDeclaration(node) && node.body,
        ) ?? declarations[0];
      if (!decl) continue;
      if (ts.isClassDeclaration(decl)) {
        const ctor = decl.members.find(ts.isConstructorDeclaration) ?? decl;
        if (
          !decl.modifiers?.some(
            (m) => m.kind === ts.SyntaxKind.AbstractKeyword,
          ) &&
          !privateMember(ctor)
        )
          register(
            `${decl.name.text}.constructor`,
            "constructor",
            ctor,
            path,
            checker
              .getSignaturesOfType(
                checker.getTypeOfSymbolAtLocation(symbol, decl),
                ts.SignatureKind.Construct,
              )
              .map((signature) =>
                checker.signatureToString(
                  signature,
                  decl,
                  ts.TypeFormatFlags.NoTruncation,
                ),
              )
              .join("; "),
          );
        members(checker.getDeclaredTypeOfSymbol(symbol), exported.name);
        members(checker.getTypeOfSymbolAtLocation(symbol, decl), exported.name);
      } else {
        const type = checker.getTypeOfSymbolAtLocation(symbol, decl);
        const signatures = checker.getSignaturesOfType(
          type,
          ts.SignatureKind.Call,
        );
        if (
          ts.isFunctionDeclaration(decl) ||
          (ts.isVariableDeclaration(decl) && signatures.length)
        ) {
          const target = ts.isVariableDeclaration(decl)
            ? decl.initializer
            : decl;
          register(
            exported.name,
            "function",
            target,
            path,
            signatures
              .map((signature) =>
                checker.signatureToString(
                  signature,
                  target,
                  ts.TypeFormatFlags.NoTruncation,
                ),
              )
              .join("; "),
          );
          for (const signature of signatures) {
            const returned = checker.getReturnTypeOfSignature(signature);
            if (returned.getSymbol()?.declarations?.some(ts.isClassDeclaration))
              continue;
            members(returned, `${exported.name}()`);
          }
        } else if (
          ts.isInterfaceDeclaration(decl) ||
          ts.isTypeAliasDeclaration(decl)
        ) {
          register(`type:${exported.name}`, "type", decl, path, decl.getText());
        } else {
          register(
            `value:${exported.name}`,
            "value",
            decl,
            path,
            checker.typeToString(type, decl, ts.TypeFormatFlags.NoTruncation),
          );
          members(type, exported.name);
        }
      }
    }
  }

  function apiForDeclaration(decl) {
    if (!decl) return;
    const direct = declarationIds.get(key(decl));
    if (direct) return direct;
    const symbol = decl.name && checker.getSymbolAtLocation(decl.name);
    for (const candidate of symbol?.declarations ?? []) {
      const found = declarationIds.get(key(candidate));
      if (found) return found;
    }
    if (ts.isClassDeclaration(decl))
      return declarationIds.get(
        key(decl.members.find(ts.isConstructorDeclaration) ?? decl),
      );
    if (
      ts.isPropertyAssignment(decl) ||
      ts.isPropertyDeclaration(decl) ||
      ts.isVariableDeclaration(decl)
    )
      return decl.initializer && declarationIds.get(key(decl.initializer));
  }
  const assertionImports = new Map();
  function assertionCall(node) {
    if (!ts.isCallExpression(node)) return false;
    const sf = node.getSourceFile();
    if (!assertionImports.has(sf)) {
      const imports = new Set();
      for (const statement of sf.statements)
        if (
          ts.isImportDeclaration(statement) &&
          /^(node:)?assert(\/strict)?$/.test(statement.moduleSpecifier.text)
        ) {
          if (statement.importClause?.name)
            imports.add(statement.importClause.name.text);
          const bindings = statement.importClause?.namedBindings;
          if (bindings && ts.isNamespaceImport(bindings))
            imports.add(bindings.name.text);
          else if (bindings)
            for (const element of bindings.elements)
              imports.add(element.name.text);
        }
      assertionImports.set(sf, imports);
    }
    const expr = node.expression;
    return (
      (ts.isPropertyAccessExpression(expr) &&
        assertionImports.get(sf).has(expr.expression.getText())) ||
      (ts.isIdentifier(expr) && assertionImports.get(sf).has(expr.text))
    );
  }
  function inspect(body, found, assertions, helpers = new Set()) {
    walk(body, (node) => {
      if (assertionCall(node)) {
        const text = normalize(node.getText());
        assertions.set(
          hash(`${rel(node.getSourceFile().fileName)}:${text}`).slice(0, 16),
          { ...location(node), expression: text },
        );
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        let signature;
        try {
          signature = checker.getResolvedSignature(node);
        } catch {}
        const decl = signature?.declaration;
        const constructor = ts.isNewExpression(node)
          ? symbolTarget(
              checker.getSymbolAtLocation(node.expression),
            )?.declarations?.find(ts.isClassDeclaration)
          : undefined;
        const expressionSymbol = symbolTarget(
          checker.getSymbolAtLocation(
            ts.isPropertyAccessExpression(node.expression)
              ? node.expression.name
              : node.expression,
          ),
        );
        const callbackId = expressionSymbol?.declarations
          ?.map(apiForDeclaration)
          .find(
            (candidate) =>
              candidate &&
              !["property", "value"].includes(entries.get(candidate).kind),
          );
        const id =
          apiForDeclaration(decl) ??
          apiForDeclaration(constructor) ??
          callbackId;
        if (id) found.add(id);
        if (callbackId) found.add(callbackId);
        if (
          decl?.body &&
          rel(decl.getSourceFile().fileName).startsWith("tests/") &&
          !helpers.has(decl)
        ) {
          helpers.add(decl);
          inspect(decl.body, found, assertions, helpers);
        }
      }
      if (ts.isPropertyAccessExpression(node) || ts.isIdentifier(node)) {
        const symbol = symbolTarget(
          checker.getSymbolAtLocation(
            ts.isPropertyAccessExpression(node) ? node.name : node,
          ),
        );
        for (const decl of symbol?.declarations ?? []) {
          const id = apiForDeclaration(decl);
          if (
            id &&
            ["value", "property", "accessor"].includes(entries.get(id).kind)
          )
            found.add(id);
        }
      }
    });
  }
  for (const file of tests) {
    const sf = program.getSourceFile(file);
    walk(sf, (node) => {
      if (
        !ts.isCallExpression(node) ||
        !ts.isIdentifier(node.expression) ||
        !["test", "apiTest"].includes(node.expression.text)
      )
        return;
      const name = node.arguments[0];
      if (
        !name ||
        (!ts.isStringLiteralLike(name) && !ts.isTemplateExpression(name))
      )
        return;
      const title = ts.isTemplateExpression(name)
        ? name.getText().slice(1, -1)
        : name.text;
      const options = node.arguments.find(ts.isObjectLiteralExpression);
      if (
        options?.properties.some(
          (p) =>
            p.name &&
            ["skip", "todo"].includes(p.name.getText()) &&
            p.initializer?.kind !== ts.SyntaxKind.FalseKeyword,
        )
      )
        return;
      const callback = node.arguments.find(
        (arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg),
      );
      if (!callback) return;
      const apis = new Set(),
        assertions = new Map();
      inspect(callback.body, apis, assertions);
      if (node.expression.text === "apiTest") {
        const bindings = node.arguments[1];
        if (!bindings || !ts.isArrayLiteralExpression(bindings))
          throw new Error(
            `API bindings must be literal: ${rel(file)}:${location(node).line}`,
          );
        for (const binding of bindings.elements) {
          if (!ts.isStringLiteralLike(binding) || !entries.has(binding.text))
            throw new Error(
              `Unknown API binding ${binding.getText()} in ${rel(file)}`,
            );
          apis.add(binding.text);
        }
      }
      if (!assertions.size) return;
      const id = `${rel(file)}::${title}`;
      scenarios.set(id, {
        id,
        ...location(node),
        name: title,
        explicit: node.expression.text === "apiTest",
        dynamic: ts.isTemplateExpression(name),
        apis,
        assertions: [...assertions.values()],
      });
      for (const api of apis) entries.get(api).scenarios.add(id);
    });
  }
  return { entries, scenarios, program, checker };
}

export function serializeAnalysis(analysis) {
  const entries = [...analysis.entries.values()]
    .map((entry) => ({
      ...entry,
      paths: [...entry.paths].sort(),
      scenarios: [...entry.scenarios].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const scenarios = [...analysis.scenarios.values()]
    .filter((item) => item.apis.size)
    .map((item) => ({ ...item, apis: [...item.apis].sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: 1,
    scope:
      "Both package entrypoints; exported and inherited callable members, factory methods, runtime values and exported types. Assertion links are evidence of a scenario, not proof of every parameter combination.",
    entries,
    scenarios,
  };
}
