import { renderTimeline, setCurrent, clearCurrent, setCurrentChrono, handleSeriesCompleted } from './timeline.js';
import { getProgram, loadProgram, startProgram, stopProgram, skipToSeries, getPrograms, toggleTargets } from './rest-client.js';
import { SSETypes } from "./common/sse-types.js";

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

// Initialize the Run tab (was Programs tab)
export async function initializeRunTab() {
    const programSelect = document.getElementById("choose-program");
    const seriesSelect = document.getElementById("choose-serie");
    const timelineWrapperSection = document.getElementById("run-timeline-wrapper");
    const timeline = document.getElementById("run-program-timeline");

    const startBtn = document.getElementById("start-btn");
    const stopBtn = document.getElementById("stop-btn");
    const toggleBtn = document.getElementById("toggle-btn");
    const chronoElement = document.getElementById('chrono');


    try {
        const programs = await getPrograms(); // Fetch the list of programs

        programSelect.innerHTML = ""; // Clear existing options

        // Add default "Choose program" option
        const defaultProgramOpt = document.createElement("option");
        defaultProgramOpt.disabled = true;
        defaultProgramOpt.selected = true;
        defaultProgramOpt.textContent = "Choose program";
        programSelect.appendChild(defaultProgramOpt);


        programs.slice()
            .sort((a, b) => a.id - b.id)
            .forEach(program => {
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

        startBtn.addEventListener("click", async () => {
            await startProgram();
        });

        stopBtn.addEventListener("click", async () => {
            await stopProgram();
        });

        toggleBtn.addEventListener("click", async () => {
            await toggleTargets();
        });

    } catch (err) {
        console.error("Failed to initialize Run tab:", err);
    }
}

// Listen for SSE events
document.addEventListener(SSETypes.ProgramCompleted, ({ detail: { program_id } }) => {
    updateProgramState({ program_id: null, running_series_start: null });
    clearCurrent();
    updateProgramButtons();
});

document.addEventListener(SSETypes.SeriesStarted, ({ detail: { program_id, series_index } }) => {
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

document.addEventListener(SSETypes.SeriesCompleted, ({ detail: { program_id, series_index } }) => {
    updateProgramState({ running_series_start: null });
    const chronoElement = document.getElementById('chrono');
    chronoElement.classList.add('hidden');
    updateProgramButtons();
    handleSeriesCompleted(series_index);
});

document.addEventListener(SSETypes.SeriesStopped, ({ detail: { program_id, series_index, event_index } }) => {
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

document.addEventListener(SSETypes.SeriesNext, ({ detail: { program_id, series_index } }) => {
    updateProgramState({
        program_id,
        current_series_index: series_index,
        current_event_index: 0,
    });
    setCurrent(series_index, 0);
    updateProgramButtons();
});

document.addEventListener(SSETypes.EventStarted, ({ detail: { program_id, series_index, event_index } }) => {
    updateProgramState({
        program_id,
        current_series_index: series_index,
        current_event_index: event_index,
    });
    setCurrent(series_index, event_index);
});

document.addEventListener(SSETypes.TargetStatus, ({ detail: { status } }) => {
    updateProgramState({ target_status_shown: status === 'shown' });
});

document.addEventListener(SSETypes.Chrono, ({ detail: { elapsed } }) => {
    const chronoElement = document.getElementById('chrono');
    if (chronoElement) {
        chronoElement.textContent = `${Math.floor(elapsed / 1000)}s`;
    }

    const { current_series_index } = programState;
    if (typeof current_series_index === "number" && current_series_index !== null) {
        setCurrentChrono(current_series_index, elapsed);
    }
});


document.addEventListener(SSETypes.ProgramAdded, ({ detail: { program_id } }) => {
    initializeRunTab();
});

document.addEventListener(SSETypes.ProgramDeleted, ({ detail: { program_id } }) => {
    initializeRunTab();
});


document.addEventListener('audio_playback', () => {
    // No action needed
});

