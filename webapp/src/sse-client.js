export const EventType = {
  ProgramLoaded: 'program_loaded',
  SeriesStarted: 'series_started',
  EventStarted: 'event_started',
  SeriesCompleted: 'series_completed',
  SeriesSkipped: 'series_skipped',
  ProgramCompleted: 'program_completed',
  StsStatus: 'sts_status',
  AudioUploaded: 'audio_uploaded',
  AudioDeleted: 'audio_deleted'
};

export function connectToEventStream(onEvent) {
  const source = new EventSource('/events', { withCredentials: false });

  Object.values(EventType).forEach(type => {
    source.addEventListener(type, (event) => {
      try {
        const payload = JSON.parse(event.data);
        onEvent(type, payload);

        // auto-wire for specific events
        if (type === EventType.ProgramLoaded ||
          type === EventType.SeriesStarted ||
          type === EventType.SeriesCompleted ||
          type === EventType.ProgramCompleted) {
        }

        // if (type === EventType.AudioUploaded || type === EventType.AudioDeleted) {
        //   refreshAudioList("audio-container");
        // }

      } catch (err) {
        console.error(`❌ Failed to parse event: ${type}`, err);
      }
    });
  });

  source.onopen = () => {
    console.log('🔌 SSE connection established');
  };

  source.onerror = (err) => {
    console.error('⚠️ SSE connection error:', err);
  };

  return source;
}
