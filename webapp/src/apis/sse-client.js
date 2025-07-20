import { SERVER_SSE_URL } from "../ui/views/settings_tab.js";
import { SSETypes } from "../common/sse-types.js";

export let currentSSESource = null;

export function connectToEventStream(onEvent) {
  if (currentSSESource) {
    currentSSESource.close();
  }
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
    console.log('SSE connection established');
  };

  currentSSESource.onerror = (err) => {
    console.error('SSE connection error:', err);
  };

  return currentSSESource;
}

