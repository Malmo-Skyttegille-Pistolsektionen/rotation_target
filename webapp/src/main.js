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

  // Broadcast SSE events
  connectToEventStream((type, payload) => {
    console.log('SSE Event:', type, payload);
    const event = new CustomEvent(type, { payload });
    document.dispatchEvent(event);
  });

});