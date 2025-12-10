import { SERVER_SSE_URL } from "../ui/views/settings_tab.js";
import { SSETypes } from "../common/sse-types.js";

export let currentSSESource = null;
export let sseConnectionStatus = "disconnected"; // "connected", "disconnected", "error", "connecting"

export function connectToEventStream(onEvent) {
  if (currentSSESource) {
    currentSSESource.close();
  }
  sseConnectionStatus = "connecting";
  window.sseConnectionStatus = sseConnectionStatus;
  document.dispatchEvent(new CustomEvent("sse_status", { detail: { status: sseConnectionStatus } }));

  currentSSESource = new EventSource(SERVER_SSE_URL, { withCredentials: false });

  Object.values(SSETypes).forEach(type => {
    currentSSESource.addEventListener(type, (event) => {
      try {
        const payload = JSON.parse(event.data);

        // Log the received event type and payload
        console.log('Received SSE event:', type, payload);

        // Pass the event to the callback
        onEvent(type, payload);
      } catch (err) {
        console.error('Failed to parse event:', type, err);
      }
    });
  });

  currentSSESource.onopen = () => {
    sseConnectionStatus = "connected";
    window.sseConnectionStatus = sseConnectionStatus;
    document.dispatchEvent(new CustomEvent("sse_status", { detail: { status: sseConnectionStatus } }));
    console.log('SSE connection established');
  };

  currentSSESource.onerror = (err) => {
    sseConnectionStatus = "error";
    window.sseConnectionStatus = sseConnectionStatus;
    let errorMsg;
    if (err?.target && err.target.readyState === EventSource.CLOSED) {
      errorMsg = "Connection closed";
    } else if (err?.message) {
      errorMsg = err.message;
    } else if (err?.isTrusted) {
      errorMsg = "Network error";
    } else {
      errorMsg = JSON.stringify(err);
    }
    // Dispatch status update
    document.dispatchEvent(new CustomEvent("sse_status", { detail: { status: `${sseConnectionStatus} (${errorMsg})` } }));
    console.error('SSE connection error:', err);

    // Dispatch a fake heartbeat reset event
    document.dispatchEvent(new CustomEvent(SSETypes.HeartBeat, { detail: { id: "reset" } }));

    setTimeout(() => connectToEventStream(onEvent), 5000); // Try to reconnect after 5s
  };

  return currentSSESource;
}

