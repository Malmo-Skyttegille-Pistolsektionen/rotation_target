import { renderTimeline, setCurrent, clearCurrent, setCurrentChrono, handleSeriesCompleted } from './timeline.js';
import { getProgram, loadProgram, startProgram, stopProgram, skipToSeries, getPrograms, toggleTargets } from '../../apis/rest-client.js';
import { SSETypes } from "../../common/sse-types.js";

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

// Cache static DOM elements at the top
const programSelect = document.getElementById("choose-program");
const seriesSelect = document.getElementById("choose-serie");
const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");
const toggleBtn = document.getElementById("toggle-btn");
const timelineWrapperSection = document.getElementById("run-timeline-wrapper");
const timeline = document.getElementById("run-program-timeline");
const chronoElement = document.getElementById('chrono');

// --- Ensure button event listeners are only added once ---
let runTabListenersAdded = false;

// Named listener functions
async function onProgramChange() {
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
}

async function onSeriesChange() {
    const index = parseInt(seriesSelect.value, 10);
    if (!isNaN(index)) {
        skipToSeries(index);
    }
}

async function onStartClick() {
    await startProgram();
}

async function onStopClick() {
    await stopProgram();
}

async function onToggleClick() {
    await toggleTargets();
}

export async function initializeRunTab() {
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

        // --- Add event listeners only once ---
        if (!runTabListenersAdded) {
            programSelect.addEventListener("change", onProgramChange);
            seriesSelect.addEventListener("change", onSeriesChange);
            startBtn.addEventListener("click", onStartClick);
            stopBtn.addEventListener("click", onStopClick);
            toggleBtn.addEventListener("click", onToggleClick);

            runTabListenersAdded = true;
        }

    } catch (err) {
        console.error("Failed to initialize Run tab:", err);
    }
}

// In event handlers, use the cached elements instead of querying again
// --- Ensure global event listeners are only added once ---
function onProgramCompleted({ detail: { program_id } }) {
    updateProgramState({ program_id: null, running_series_start: null });
    clearCurrent();
    updateProgramButtons();
}

function onSeriesStarted({ detail: { program_id, series_index } }) {
    updateProgramState({
        program_id,
        running_series_start: new Date(),
        current_series_index: series_index,
        current_event_index: 0,
    });
    setCurrent(series_index, 0);
    chronoElement.classList.remove('hidden');
    updateProgramButtons();
}

function onSeriesCompleted({ detail: { program_id, series_index } }) {
    updateProgramState({ running_series_start: null });
    chronoElement.classList.add('hidden');
    updateProgramButtons();
    handleSeriesCompleted(series_index);
}

function onSeriesStopped({ detail: { program_id, series_index, event_index } }) {
    updateProgramState({
        program_id,
        running_series_start: null,
        current_series_index: series_index,
        current_event_index: event_index,
    });
    setCurrent(series_index, event_index);
    chronoElement.classList.add('hidden');
    updateProgramButtons();
}

function onSeriesNext({ detail: { program_id, series_index } }) {
    updateProgramState({
        program_id,
        current_series_index: series_index,
        current_event_index: 0,
    });
    setCurrent(series_index, 0);
    updateProgramButtons();
}

function onEventStarted({ detail: { program_id, series_index, event_index } }) {
    updateProgramState({
        program_id,
        current_series_index: series_index,
        current_event_index: event_index,
    });
    setCurrent(series_index, event_index);
}

function onTargetStatus({ detail: { status } }) {
    updateProgramState({ target_status_shown: status === 'shown' });
}

function onChrono({ detail: { elapsed } }) {
    const chronoElement = document.getElementById('chrono');
    if (chronoElement) {
        chronoElement.textContent = `${Math.floor(elapsed / 1000)}s`;
    }

    const { current_series_index } = programState;
    if (typeof current_series_index === "number" && current_series_index !== null) {
        setCurrentChrono(current_series_index, elapsed);
    }
}

function onProgramAdded({ detail: { program_id } }) {
    initializeRunTab();
}

function onProgramDeleted({ detail: { program_id } }) {
    initializeRunTab();
}

if (!window._runTabGlobalListenersAdded) {
    document.addEventListener(SSETypes.ProgramCompleted, onProgramCompleted);
    document.addEventListener(SSETypes.SeriesStarted, onSeriesStarted);
    document.addEventListener(SSETypes.SeriesCompleted, onSeriesCompleted);
    document.addEventListener(SSETypes.SeriesStopped, onSeriesStopped);
    document.addEventListener(SSETypes.SeriesNext, onSeriesNext);
    document.addEventListener(SSETypes.EventStarted, onEventStarted);
    document.addEventListener(SSETypes.TargetStatus, onTargetStatus);
    document.addEventListener(SSETypes.Chrono, onChrono);
    document.addEventListener(SSETypes.ProgramAdded, onProgramAdded);
    document.addEventListener(SSETypes.ProgramDeleted, onProgramDeleted);
    document.addEventListener('audio_playback', () => {
        // No action needed
    });

    window._runTabGlobalListenersAdded = true;
}

