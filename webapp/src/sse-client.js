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
};

export function connectToEventStream(onEvent) {
  const source = new EventSource(`${SERVER_SSE_URL}`, { withCredentials: false });

  Object.values(EventType).forEach(type => {
    source.addEventListener(type, (event) => {
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

  source.onopen = () => {
    console.log('SSE connection established');
  };

  source.onerror = (err) => {
    console.error('SSE connection error:', err);
  };

  return source;
}

