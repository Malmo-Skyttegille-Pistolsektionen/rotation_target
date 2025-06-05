import { initializeProgramsTab } from './programs.js';
import { initializeAudiosTab } from './audios.js'; // Ensure this is imported only once
import { initializeUploadProgramTab } from './upload-program.js';

document.addEventListener("DOMContentLoaded", async () => {
  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
  const appName = "Malmö Skyttegille Rotation Target";
  const appTitle = `${appName} v${appVersion}`;
  document.title = appTitle;
  document.querySelector("#footer span").textContent = appTitle;

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

  // Initialize tabs
  await initializeProgramsTab();
});