/** A machine-readable result stream alongside Node's normal spec reporter. */
export default async function* testCaseReporter(events) {
  for await (const event of events) {
    if (event.type === "test:pass" || event.type === "test:fail") {
      const { name, file, line, column, skip, todo } = event.data;
      yield JSON.stringify({
        status: event.type === "test:pass" ? "passed" : "failed",
        name,
        file,
        line,
        column,
        skipped: !!skip,
        todo: !!todo,
      }) + "\n";
    }
  }
}
