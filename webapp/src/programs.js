import { renderTimeline, setCurrent, clearCurrent } from './timeline.js';
import { loadPrograms, getProgram, loadProgram, startProgram, stopProgram, skipToSeries } from './rest-client.js';
import { EventType } from './sse-client.js';

// Program state to track the current program and series
const programState = {
    program_id: null,
    running_series_start: null, // Tracks when the series started or null if not running
    current_series_index: null,
    current_event_index: null,
    target_status_shown: false,
};

// Methods to interact with programState
export function getProgramState() {
    return programState;
}

export function updateProgramState(updates) {
    Object.assign(programState, updates);
}

// Methods to handle UI updates based on program state
export function updateProgramButtons() {
    const startBtn = document.getElementById("start-btn");
    const stopBtn = document.getElementById("stop-btn");

    const { program_id, running_series_start } = programState;

    if (program_id !== null && running_series_start === null) {
        // Program is loaded but no series is running
        startBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
    } else if (running_series_start !== null) {
        // Series is running
        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
    } else {
        // No program loaded
        startBtn.classList.add('hidden');
        stopBtn.classList.add('hidden');
    }
}

// Initialize the Programs tab
export async function initializeProgramsTab() {
    const programSelect = document.getElementById("choose-program");
    const seriesSelect = document.getElementById("choose-serie");
    const showJsonBtn = document.getElementById("show-json");
    const timelineWrapperSection = document.getElementById("programs-timeline-wrapper");
    const timeline = document.getElementById("programs-timeline");

    const startBtn = document.getElementById("start-btn");
    const stopBtn = document.getElementById("stop-btn");
    const chronoElement = document.getElementById('chrono');


    try {
        const programs = await loadPrograms(); // Fetch the list of programs
        console.log("Fetched programs:", programs); // Debugging log

        programSelect.innerHTML = ""; // Clear existing options

        // Add default "Choose program" option
        const defaultProgramOpt = document.createElement("option");
        defaultProgramOpt.disabled = true;
        defaultProgramOpt.selected = true;
        defaultProgramOpt.textContent = "Choose program";
        programSelect.appendChild(defaultProgramOpt);

        programs.forEach(program => {
            const opt = document.createElement("option");
            opt.value = program.id;
            opt.textContent = program.title;
            programSelect.appendChild(opt);
        });

        programSelect.addEventListener("change", async () => {

            const id = parseInt(programSelect.value, 10);
            if (!isNaN(id)) {
                // Remove the default option once a program is selected
                const defaultOption = programSelect.querySelector("option[disabled]");
                if (defaultOption) {
                    defaultOption.remove();
                }

                await loadProgram(id);
                try {
                    const program = await getProgram(id);
                    window.currentProgram = program;
                    renderTimeline(timeline, program);
                    setCurrent(0, 0);

                    updateProgramState({ program_id: id, running_series_start: null });
                    updateProgramButtons();

                    // Populate series dropdown
                    seriesSelect.innerHTML = "";
                    const defaultSeriesOpt = document.createElement("option");
                    defaultSeriesOpt.disabled = true;
                    defaultSeriesOpt.selected = true;
                    defaultSeriesOpt.textContent = "Choose a series";
                    seriesSelect.appendChild(defaultSeriesOpt);

                    program.series.forEach((s, index) => {
                        const opt = document.createElement("option");
                        opt.value = index;
                        opt.textContent = s.name + (s.optional ? ' (optional)' : '');
                        seriesSelect.appendChild(opt);
                    });

                    // Make elements visible
                    seriesSelect.classList.remove("hidden");
                    showJsonBtn.classList.remove("hidden");
                    timelineWrapperSection.classList.remove("hidden");

                    // Enable start and stop buttons
                    startBtn.disabled = false;
                    stopBtn.disabled = false;

                } catch (err) {
                    console.error("Failed to fetch program by ID:", err);
                }
            }
        });

        seriesSelect.addEventListener("change", async () => {
            const index = parseInt(seriesSelect.value, 10);
            if (!isNaN(index)) {
                skipToSeries(index);
            }
        });

        showJsonBtn.addEventListener("click", () => {
            if (window.currentProgram) {
                const raw = JSON.stringify(window.currentProgram, null, 2);
                const blob = new Blob([raw], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                window.open(url, '_blank');
            }
        });

        startBtn.addEventListener("click", async () => {
            await startProgram();
        });

        stopBtn.addEventListener("click", async () => {
            await stopProgram();
        });
    } catch (err) {
        console.error("Failed to initialize Programs tab:", err);
    }
}

// Listen for SSE events
document.addEventListener(EventType.ProgramCompleted, ({ detail: { program_id } }) => {
    updateProgramState({ program_id: null, running_series_start: null });
    clearCurrent();
    updateProgramButtons();
});

document.addEventListener(EventType.SeriesStarted, ({ detail: { program_id, series_index } }) => {
    updateProgramState({
        program_id,
        running_series_start: new Date(),
        current_series_index: series_index,
        current_event_index: 0,
    });
    setCurrent(series_index, 0);
    const chronoElement = document.getElementById('chrono');
    chronoElement.classList.remove('hidden');
    updateProgramButtons();
});

document.addEventListener(EventType.SeriesCompleted, ({ detail: { program_id } }) => {
    updateProgramState({ running_series_start: null });
    const chronoElement = document.getElementById('chrono');
    chronoElement.classList.add('hidden');
    updateProgramButtons();
});

document.addEventListener(EventType.SeriesStopped, ({ detail: { program_id, series_index, event_index } }) => {
    updateProgramState({
        program_id,
        running_series_start: null,
        current_series_index: series_index,
        current_event_index: event_index,
    });
    setCurrent(series_index, event_index);
    const chronoElement = document.getElementById('chrono');
    chronoElement.classList.add('hidden');
    updateProgramButtons();
});

document.addEventListener(EventType.SeriesNext, ({ detail: { program_id, series_index } }) => {
    updateProgramState({
        program_id,
        current_series_index: series_index,
        current_event_index: 0,
    });
    setCurrent(series_index, 0);
    updateProgramButtons();
});

document.addEventListener(EventType.EventStarted, ({ detail: { program_id, series_index, event_index } }) => {
    updateProgramState({
        program_id,
        current_series_index: series_index,
        current_event_index: event_index,
    });
    setCurrent(series_index, event_index);
});

document.addEventListener(EventType.TargetStatus, ({ detail: { status } }) => {
    updateProgramState({ target_status_shown: status === 'shown' });
});

document.addEventListener(EventType.Chrono, ({ detail: { elapsed } }) => {
    const chronoElement = document.getElementById('chrono');
    if (chronoElement) {
        chronoElement.textContent = `${Math.floor(elapsed / 1000)}s`;
    }
});