import { isAudioViewerOpen as checkAudioViewerOpen } from "../utils/comparison.js";

let currentlyPlayingAudio = null;

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

export function isAudioViewerOpen() {
    return checkAudioViewerOpen();
}
