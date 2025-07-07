import { SERVER_SSE_URL } from "./config.js";

export const EventType = {
  ProgramAdded: 'program_added',
  ProgramDeleted: 'program_deleted',
  ProgramStarted: 'program_started',
  ProgramCompleted: 'program_completed',
  SeriesStarted: 'series_started',
  SeriesCompleted: 'series_completed',
  SeriesStopped: 'series_stopped',
  SeriesNext: 'series_next',
  EventStarted: 'event_started',
  TargetStatus: 'target_status',
  AudioAdded: 'audio_added',
  AudioDeleted: 'audio_deleted',
  Chrono: 'chrono',
  AdminModeStatus: 'admin_mode_status',
};

export let currentSSESource = null;

export function connectToEventStream(onEvent) {
  if (currentSSESource) {
    currentSSESource.close();
  }
  currentSSESource = new EventSource(SERVER_SSE_URL, { withCredentials: false });

  Object.values(EventType).forEach(type => {
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

