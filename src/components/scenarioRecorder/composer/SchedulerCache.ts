const SCHEDULER_FLOW_CACHE_KEY = 'scheduler:currentComposedFlow';

export const cacheFlowForScheduler = (payload: {
  alias: string;
  flowId: string;
  flowJson: string;
  flowName: string;
}) => {
  try {
    localStorage.setItem(
      SCHEDULER_FLOW_CACHE_KEY,
      JSON.stringify({
        ...payload,
        updatedAt: new Date().toISOString(),
      })
    );
  } catch {
    // ignore storage errors
  }
};
