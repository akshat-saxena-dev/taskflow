export type SupportedJobType = 'email' | 'report' | 'data-processing';

export const SUPPORTED_JOB_TYPES: readonly SupportedJobType[] = ['email', 'report', 'data-processing'];

export const runDemoHandler = async (type: string, payload: Record<string, unknown>, attemptNumber = 1): Promise<Record<string, unknown>> => {
  const failuresBeforeSuccess = payload.failuresBeforeSuccess;
  if (payload.simulateFailure === true || (typeof failuresBeforeSuccess === 'number' && attemptNumber <= failuresBeforeSuccess)) {
    const reason = typeof payload.simulatedError === 'string' ? payload.simulatedError : 'Simulated demo processing failure';
    throw new Error(reason);
  }

  switch (type as SupportedJobType) {
    case 'email':
      return { demo: true, message: 'Email handler completed without sending an email.', recipient: payload.to ?? null };
    case 'report':
      return { demo: true, message: 'Demo report generated.', reportType: payload.reportType ?? 'summary' };
    case 'data-processing':
      return { demo: true, message: 'Demo data processing completed.', recordsProcessed: Array.isArray(payload.records) ? payload.records.length : 0 };
    default:
      throw new Error(`Unsupported job type: ${type}`);
  }
};
