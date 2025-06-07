import { renderTimeline, setCurrent, clearCurrent } from './timeline.js';
import { loadPrograms, getProgram, loadProgram, startProgram, stopProgram, skipToSeries } from './rest-client.js';

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