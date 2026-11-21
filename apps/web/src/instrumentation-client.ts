if (process.env.NODE_ENV === "development") {
  const original = performance.measure.bind(performance);
  performance.measure = function measure(
    ...args: Parameters<typeof original>
  ) {
    try {
      return original(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("negative time stamp") ||
        message.includes("cannot be negative")
      ) {
        return undefined as unknown as PerformanceMeasure;
      }
      throw error;
    }
  } as typeof performance.measure;
}
