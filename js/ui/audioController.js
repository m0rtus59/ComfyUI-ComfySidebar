let currentlyPlayingAudio = null;
let activeComparisonViewer = null;

export function stopAllAudioPlayback() {
    if (currentlyPlayingAudio) {
        currentlyPlayingAudio.pause();
        currentlyPlayingAudio.currentTime = 0;
        if (typeof currentlyPlayingAudio._onResetUI === "function") {
            currentlyPlayingAudio._onResetUI();
        }
        currentlyPlayingAudio = null;
    }
}

export function setCurrentlyPlayingAudio(audio) {
    stopAllAudioPlayback();
    currentlyPlayingAudio = audio;
}

export function getCurrentlyPlayingAudio() {
    return currentlyPlayingAudio;
}

export function setActiveComparisonViewer(viewer) {
    activeComparisonViewer = viewer;
}

export function getActiveComparisonViewer() {
    return activeComparisonViewer;
}

export function isAudioViewerOpen() {
    return !!(activeComparisonViewer && activeComparisonViewer.isAudio);
}
