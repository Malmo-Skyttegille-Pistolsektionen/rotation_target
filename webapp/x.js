connectToEventStream((type, payload) => {
    const handlers = {
        [EventType.ProgramUploaded]: ({ program_id }) => {
            programState.program_id = program_id;
            programState.series_running = false; // Reset running state
            programState.current_series_index = 0;
            programState.current_event_index = 0;
            console.log('Program uploaded:', programState);

        },
        [EventType.ProgramStarted]: ({ program_id }) => {
            programState.program_id = program_id;
            programState.series_running = false; // Program started, but no series is running yet
            console.log('Program started:', programState);

        },
        [EventType.ProgramCompleted]: ({ program_id }) => {
            programState.program_id = program_id;
            programState.series_running = false; // Program is no longer running
            clearCurrent();
            console.log('Program completed:', programState);

        },
        [EventType.SeriesStarted]: ({ program_id, series_index }) => {
            programState.program_id = program_id;
            programState.series_running = true; // Series is actively running
            programState.current_series_index = series_index;
            programState.current_event_index = 0;
            setCurrent(series_index, 0);
            const chronoElement = document.getElementById('chrono');
            chronoElement.classList.remove('hidden');


            console.log('Series started:', programState);

        },
        [EventType.SeriesCompleted]: ({ program_id, series_index }) => {
            programState.program_id = program_id;
            programState.series_running = false; // Series has completed
            console.log('Series completed:', programState);

        },
        [EventType.SeriesStopped]: ({ program_id, series_index, event_index }) => {
            programState.program_id = program_id;
            programState.current_series_index = series_index;
            programState.current_event_index = event_index;
            setCurrent(programState.current_series_index, programState.current_event_index);
            programState.series_running = false; // Series has completed
            const chronoElement = document.getElementById('chrono');
            chronoElement.classList.add('hidden');
            console.log('Series stopped:', programState);

        },
        [EventType.SeriesNext]: ({ program_id, series_index }) => {
            programState.program_id = program_id;
            programState.current_series_index = series_index;
            programState.current_event_index = 0;
            setCurrent(programState.current_series_index, programState.current_event_index);
            console.log('Series next:', programState);

        },
        [EventType.EventStarted]: ({ program_id, series_index, event_index }) => {
            programState.program_id = program_id;
            programState.current_series_index = series_index;
            programState.current_event_index = event_index;
            setCurrent(programState.current_series_index, programState.current_event_index);
            console.log('Event started:', programState);

        },
        [EventType.TargetStatus]: ({ status }) => {
            programState.target_status_shown = status === 'shown'; // Convert string to boolean
            console.log('Target status updated:', programState);

        },
        [EventType.Chrono]: ({ elapsed, remaining, total }) => {
            console.log('Chrono: ', { elapsed, remaining, total });
            // Update the text in the #chrono element
            const chronoElement = document.getElementById('chrono');

            if (chronoElement) {
                chronoElement.textContent = `${Math.floor(elapsed / 1000)}s`;
            }
        },

    }

    if (handlers[type]) {
        handlers[type](payload);
    } else {
        console.warn('Unhandled event type:', type, payload);
    }
});
