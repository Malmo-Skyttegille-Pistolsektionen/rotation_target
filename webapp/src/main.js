import { initializeProgramsTab } from './programs.js';
import { initializeAudiosTab, refreshAudioList } from './audios.js'; // Ensure this is imported only once
import { initializeUploadProgramTab } from './upload-program.js';
import { EventType, connectToEventStream } from './sse-client.js';

import {

  getStatus
} from './rest-client.js';
import { setCurrent, clearCurrent } from './timeline.js';

document.addEventListener("DOMContentLoaded", async () => {

  // Program state to track the current program and series
  const programState = {
    program_id: null,
    series_running: false, // Updated: Only true when a series is actively running
    current_series_index: null,
    current_event_index: null,
    target_status_shown: false // Changed from string to boolean
  };

  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
  const appName = "Malmö Skyttegille Rotation Target";
  const appTitle = `${appName} v${appVersion}`;
  document.title = appTitle;
  document.querySelector("#footer span").textContent = appTitle;

  // Initialize tabs
  await initializeProgramsTab();


  const programTabButton = document.getElementById("program-tab-button");
  const audioTabButton = document.getElementById("audio-tab-button");
  const uploadProgramTabButton = document.getElementById("upload-program-tab-button");

  const programSection = document.getElementById("program-section");
  const audioSection = document.getElementById("audio-section");
  const uploadProgramSection = document.getElementById("upload-program-section");

  // Tab switching logic
  programTabButton.addEventListener("click", () => {
    programTabButton.classList.add("active");
    audioTabButton.classList.remove("active");
    uploadProgramTabButton.classList.remove("active");

    programSection.classList.remove("hidden");
    audioSection.classList.add("hidden");
    uploadProgramSection.classList.add("hidden");
  });

  audioTabButton.addEventListener("click", async () => {
    audioTabButton.classList.add("active");
    programTabButton.classList.remove("active");
    uploadProgramTabButton.classList.remove("active");

    audioSection.classList.remove("hidden");
    programSection.classList.add("hidden");
    uploadProgramSection.classList.add("hidden");

    await initializeAudiosTab(); // Ensure this function is defined only once
  });

  uploadProgramTabButton.addEventListener("click", () => {
    uploadProgramTabButton.classList.add("active");
    programTabButton.classList.remove("active");
    audioTabButton.classList.remove("active");

    uploadProgramSection.classList.remove("hidden");
    programSection.classList.add("hidden");
    audioSection.classList.add("hidden");

    initializeUploadProgramTab();
  });


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
      [EventType.SeriesStarted]: ({ program_id, series_index }) => {
        programState.program_id = program_id;
        programState.series_running = true; // Series is actively running
        programState.current_series_index = series_index;
        programState.current_event_index = 0;
        setCurrent(series_index, 0);
        console.log('Series started:', programState);

      },
      [EventType.EventStarted]: ({ program_id, series_index, event_index }) => {
        programState.program_id = program_id;
        programState.current_series_index = series_index;
        programState.current_event_index = event_index;
        setCurrent(series_index, event_index);
        console.log('Event started:', programState);

      },
      [EventType.SeriesCompleted]: ({ program_id, series_index }) => {
        programState.program_id = program_id;
        programState.series_running = false; // Series has completed
        console.log('Series completed:', programState);

      },
      [EventType.SeriesNext]: ({ program_id, series_index }) => {
        programState.program_id = program_id;
        programState.current_series_index = series_index;
        programState.current_event_index = 0;
        setCurrent(series_index, 0);
        console.log('Series next:', programState);

      },
      [EventType.ProgramCompleted]: ({ program_id }) => {
        programState.program_id = program_id;
        programState.series_running = false; // Program is no longer running
        clearCurrent();
        console.log('Program completed:', programState);

      },
      [EventType.TargetStatus]: ({ status }) => {
        programState.target_status_shown = status === 'shown'; // Convert string to boolean
        console.log('Target status updated:', programState);

      },
      [EventType.AudioUploaded]: ({ id }) => {
        refreshAudioList();
        console.log('Audio uploaded:', id);

      },
      [EventType.AudioDeleted]: ({ id }) => {
        refreshAudioList();
        console.log('Audio deleted:', id);

      }
    };

    if (handlers[type]) {
      handlers[type](payload);
    } else {
      console.warn('Unhandled event type:', type, payload);
    }
  });


});