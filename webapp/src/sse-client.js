import { SERVER_SSE_URL } from "./config.js";

export const EventType = {
  ProgramUploaded: 'program_uploaded',
  ProgramStarted: 'program_started',
  ProgramCompleted: 'program_completed',
  SeriesStarted: 'series_started',
  SeriesCompleted: 'series_completed',
  SeriesStopped: 'series_stopped',
  SeriesNext: 'series_next',
  EventStarted: 'event_started',
  TargetStatus: 'target_status',
  AudioAdded: 'audio_added',
  AudioDeleted: 'audio_deleted'
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

// event: program_uploaded
// data: {"program_id":1}

// event: program_started
// data: {"program_id":0}

// event: program_completed
// data: {"program_id":0}

// event: series_started
// data: {"program_id":0, "series_index":0}

// event: series_stopped
// data: {"program_id":0, "series_index":0, "event_index":1}

// event: event_started
// data: {"program_id":0, "series_index":0, "event_index":1}

// event: series_completed
// data: {"program_id":0, "series_index":0}

// event: series_next
// data: {"program_id":0, "series_index":0}

// event: target_status
// data: {"status":"shown"} # shown, hidden

// event: audio_added
// data: {"id":1}

// event: audio_deleted
// data: {"id":1}