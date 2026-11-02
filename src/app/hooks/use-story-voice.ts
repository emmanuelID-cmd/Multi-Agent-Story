"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface VoiceOption {
  name: string;
  lang: string;
  displayName: string;
  gender: "female" | "male" | "neutral";
  isNatural: boolean;
}

const VOICE_PREF_KEY = "weaver_preferred_voice_name";

function formatVoiceName(v: SpeechSynthesisVoice): { displayName: string; gender: "female" | "male" | "neutral"; isNatural: boolean } {
  const name = v.name;
  const isNatural = name.includes("Natural") || name.includes("Online") || name.includes("Google");
  
  const lower = name.toLowerCase();
  const isFemale = lower.includes("jenny") || lower.includes("aria") || lower.includes("zira") || lower.includes("samantha") || lower.includes("sonia") || lower.includes("female") || lower.includes("karen") || lower.includes("victoria") || lower.includes("michelle") || lower.includes("ana");
  const isMale = lower.includes("guy") || lower.includes("david") || lower.includes("mark") || lower.includes("christopher") || lower.includes("ryan") || lower.includes("male") || lower.includes("daniel") || lower.includes("steffan");
  const gender = isFemale ? "female" : isMale ? "male" : "neutral";

  // Clean friendly display name
  let clean = name
    .replace(/^Microsoft\s+/i, "")
    .replace(/\s+Online\s+\(Natural\)/i, " (Natural)")
    .replace(/\s+Desktop/i, "")
    .replace(/-\s+English\s+\([^)]+\)/i, "")
    .trim();

  const icon = gender === "female" ? "👩" : gender === "male" ? "👨" : "🎙️";
  const badge = isNatural ? "★" : "";
  const displayName = `${icon} ${clean} ${badge}`.trim();

  return { displayName, gender, isNatural };
}

export function useStoryVoice() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [rate, setRateState] = useState(1.0);
  const [volume, setVolumeState] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [spokenCharIndex, setSpokenCharIndex] = useState<number>(-1);
  const [spokenCharLength, setSpokenCharLength] = useState<number>(0);
  const [isListening, setIsListening] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  const [sttSupported, setSttSupported] = useState(false);
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([]);
  const [selectedVoiceName, setSelectedVoiceNameState] = useState<string>("");

  const prevVolumeRef = useRef<number>(1.0);
  const recognitionRef = useRef<any>(null);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const availableVoicesRef = useRef<SpeechSynthesisVoice[]>([]);

  // Load saved volume
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedVol = localStorage.getItem("weaver_voice_volume");
      if (savedVol !== null) {
        const v = parseFloat(savedVol);
        if (!isNaN(v) && v >= 0 && v <= 1) {
          setVolumeState(v);
          if (v === 0) setIsMuted(true);
        }
      }
    }
  }, []);

  // Load and classify available voices
  const refreshVoices = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const rawVoices = window.speechSynthesis.getVoices();
    if (!rawVoices || rawVoices.length === 0) return;

    availableVoicesRef.current = rawVoices;

    // Filter to English voices
    const enVoices = rawVoices.filter(v => v.lang.startsWith("en") || !v.lang);
    const options: VoiceOption[] = (enVoices.length > 0 ? enVoices : rawVoices).map(v => {
      const meta = formatVoiceName(v);
      return {
        name: v.name,
        lang: v.lang,
        displayName: meta.displayName,
        gender: meta.gender,
        isNatural: meta.isNatural,
      };
    });

    // Sort: Natural female voices first, then other natural, then standard female, then male
    options.sort((a, b) => {
      if (a.isNatural && !b.isNatural) return -1;
      if (!a.isNatural && b.isNatural) return 1;
      if (a.gender === "female" && b.gender !== "female") return -1;
      if (a.gender !== "female" && b.gender === "female") return 1;
      return a.displayName.localeCompare(b.displayName);
    });

    setVoiceOptions(options);

    // Load saved voice or choose best natural female voice
    const saved = localStorage.getItem(VOICE_PREF_KEY);
    const matchedSaved = saved && rawVoices.some(v => v.name === saved);
    if (matchedSaved) {
      setSelectedVoiceNameState(saved);
    } else {
      // Pick best natural female voice
      const bestDefault = options.find(o => o.isNatural && o.gender === "female")
        || options.find(o => o.gender === "female")
        || options.find(o => o.isNatural)
        || options[0];
      if (bestDefault) {
        setSelectedVoiceNameState(bestDefault.name);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setTtsSupported("speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
      const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      setSttSupported(Boolean(SpeechRec));

      refreshVoices();
      if ("speechSynthesis" in window) {
        window.speechSynthesis.onvoiceschanged = refreshVoices;
      }
    }
  }, [refreshVoices]);

  const setSelectedVoiceName = useCallback((name: string) => {
    setSelectedVoiceNameState(name);
    if (typeof window !== "undefined") {
      localStorage.setItem(VOICE_PREF_KEY, name);
    }
  }, []);

  // Stop active speech on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
    };
  }, []);

  const stop = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    activeUtteranceRef.current = null;
    setIsSpeaking(false);
    setIsPaused(false);
    setCurrentId(null);
    setSpokenCharIndex(-1);
    setSpokenCharLength(0);
  }, []);

  const pause = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  }, []);

  const resume = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    }
  }, []);

  const setVolume = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(1, val));
    setVolumeState(clamped);
    if (clamped === 0) {
      setIsMuted(true);
    } else {
      setIsMuted(false);
      prevVolumeRef.current = clamped;
    }
    if (typeof window !== "undefined") {
      localStorage.setItem("weaver_voice_volume", String(clamped));
    }
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const next = !prev;
      if (!next && volume === 0) {
        setVolumeState(prevVolumeRef.current || 0.8);
      }
      return next;
    });
  }, [volume]);

  const cycleVolume = useCallback(() => {
    // 3 volume levels: 33% (1 wave), 66% (2 waves), 100% (3 waves), and 0% (0 waves / muted)
    if (isMuted || volume === 0) {
      setIsMuted(false);
      setVolume(0.33);
    } else if (volume <= 0.45) {
      setIsMuted(false);
      setVolume(0.66);
    } else if (volume <= 0.8) {
      setIsMuted(false);
      setVolume(1.0);
    } else {
      setIsMuted(true);
      setVolume(0);
    }
  }, [isMuted, volume, setVolume]);

  const speak = useCallback((text: string, id: string = "default") => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    // If already speaking this item, toggle pause/resume
    if (currentId === id && isSpeaking) {
      if (isPaused) {
        resume();
      } else {
        pause();
      }
      return;
    }

    // Cancel any prior speech
    window.speechSynthesis.cancel();

    // Clean text of markdown characters while preserving exact string indices
    const cleanedText = text
      .replace(/[#*_`~>]/g, " ")
      .trim();

    if (!cleanedText) return;

    const utterance = new SpeechSynthesisUtterance(cleanedText);
    utterance.rate = rate;
    utterance.volume = isMuted ? 0 : volume;
    // Slight pitch increase (1.05) removes mechanical monotone drone
    utterance.pitch = 1.05;

    // Select chosen voice from available voices
    const currentVoices = availableVoicesRef.current.length > 0
      ? availableVoicesRef.current
      : window.speechSynthesis.getVoices();

    const chosenVoice = currentVoices.find(v => v.name === selectedVoiceName)
      || currentVoices.find(v => v.lang.startsWith("en") && (v.name.includes("Jenny") || v.name.includes("Aria") || v.name.includes("Google") || v.name.includes("Zira")))
      || currentVoices.find(v => v.lang.startsWith("en"))
      || currentVoices[0];

    if (chosenVoice) {
      utterance.voice = chosenVoice;
    }

    utterance.onstart = () => {
      setIsSpeaking(true);
      setIsPaused(false);
      setCurrentId(id);
      setSpokenCharIndex(0);
    };

    utterance.onboundary = (event: SpeechSynthesisEvent) => {
      if (event.name === "word") {
        setSpokenCharIndex(event.charIndex);
        setSpokenCharLength(event.charLength || 0);
      }
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setIsPaused(false);
      setCurrentId(null);
      setSpokenCharIndex(-1);
      setSpokenCharLength(0);
      activeUtteranceRef.current = null;
    };

    utterance.onerror = (e) => {
      if (e.error !== "canceled" && e.error !== "interrupted") {
        console.warn("Speech synthesis error:", e.error);
      }
      setIsSpeaking(false);
      setIsPaused(false);
      setCurrentId(null);
      setSpokenCharIndex(-1);
      setSpokenCharLength(0);
      activeUtteranceRef.current = null;
    };

    activeUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [currentId, isSpeaking, isPaused, rate, volume, isMuted, selectedVoiceName, pause, resume]);

  const cycleRate = useCallback(() => {
    const rates = [0.8, 1.0, 1.2, 1.5];
    const currentIndex = rates.indexOf(rate);
    const nextRate = rates[(currentIndex + 1) % rates.length];
    setRateState(nextRate);
  }, [rate]);

  const setRate = useCallback((newRate: number) => {
    setRateState(newRate);
    if (activeUtteranceRef.current && isSpeaking) {
      const wasPaused = isPaused;
      const id = currentId;
      const fullText = activeUtteranceRef.current.text;
      stop();
      if (!wasPaused && id) {
        speak(fullText, id);
      }
    }
  }, [isSpeaking, isPaused, currentId, stop, speak]);

  const startDictation = useCallback((onResult: (text: string) => void) => {
    if (typeof window === "undefined") return;
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      alert("Voice speech recognition is not supported in this browser. Please try Chrome, Edge, or Safari.");
      return;
    }

    try {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      const recognition = new SpeechRec();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript;
        if (transcript) {
          onResult(transcript);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn("Speech recognition error:", event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.warn("Failed to start speech recognition:", err);
      setIsListening(false);
    }
  }, []);

  const stopDictation = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      setIsListening(false);
    }
  }, []);

  return {
    isSpeaking,
    isPaused,
    currentId,
    rate,
    volume,
    isMuted,
    spokenCharIndex,
    spokenCharLength,
    isListening,
    ttsSupported,
    sttSupported,
    voiceOptions,
    selectedVoiceName,
    setSelectedVoiceName,
    speak,
    pause,
    resume,
    stop,
    setRate,
    cycleRate,
    setVolume,
    cycleVolume,
    toggleMute,
    startDictation,
    stopDictation,
  };
}
