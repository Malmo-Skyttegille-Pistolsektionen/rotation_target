
export function renderTimeline(data) {
  const container = document.getElementById("timeline");
  container.innerHTML = "";

  data.series.forEach((series, sIdx) => {
    const wrapper = document.createElement("div");
    wrapper.className = "series";
    if (series.optional) wrapper.classList.add("optional");
    wrapper.dataset.seriesIndex = sIdx;

    const title = document.createElement("div");
    title.textContent = series.name;
    wrapper.appendChild(title);

    const row = document.createElement("div");
    row.className = "events";

    series.events.forEach((ev, eIdx) => {
      const evDiv = document.createElement("div");
      evDiv.className = "event";
      evDiv.dataset.eventIndex = eIdx;

      const dur = document.createElement("div");
      dur.className = "dur";
      dur.textContent = (ev.duration / 10).toFixed(1);
      evDiv.appendChild(dur);

      const sym = document.createElement("div");
      sym.className = "symbol";
      if (ev.audio_id) {
        sym.classList.add("A");
        sym.textContent = "A";
      } else if (ev.command === "show") {
        sym.classList.add("filled");
        sym.textContent = "";
      } else if (ev.command === "hide") {
        sym.classList.add("empty");
        sym.textContent = "";
      } else {
        sym.textContent = "?";
      }
      evDiv.appendChild(sym);

      row.appendChild(evDiv);
    });

    wrapper.appendChild(row);
    container.appendChild(wrapper);
  });
}

export function setCurrent(si, ei) {
  document.querySelectorAll(".series").forEach(s => s.classList.remove("current"));
  document.querySelectorAll(".event").forEach(e => e.classList.remove("current"));
  const currentSeries = document.querySelector(`[data-series-index='${si}']`);
  if (currentSeries) {
    currentSeries.classList.add("current");
    const currentEvent = currentSeries.querySelector(`[data-event-index='${ei}']`);
    if (currentEvent) currentEvent.classList.add("current");
  }
}

export function toggleRaw(program) {
  const raw = document.getElementById("raw");
  raw.style.display = raw.style.display === "none" ? "block" : "none";
  if (!raw.textContent && program) {
    raw.textContent = JSON.stringify(program, null, 2);
  }
}
