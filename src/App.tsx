import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Activity, 
  Zap, 
  Shield, 
  Terminal, 
  Lock, 
  Unlock, 
  Save, 
  FolderOpen,
  Trophy,
  ChevronRight,
  Power,
  Cpu,
  Keyboard,
  Clock,
  Play,
  Square,
  Circle
} from 'lucide-react';
import { Background } from './components/Background';
import { GoogleGenAI, Type } from "@google/genai";

// --- Types ---
interface Preset {
  name: string;
  freq: number;
  cutoff: number;
  fmAmount: number;
  fmRatio: number;
  oscType: OscillatorType | 'wavetable' | 'string' | 'granular';
  feedback?: number;
  grainSize?: number;
  grainDensity?: number;
}

interface Modulator {
  id: string;
  type: 'lfo' | 'envelope';
  rate: number;
  depth: number;
  target: string;
}

interface ProjectTemplate {
  name: string;
  presets: Preset[];
  automation: AutomationEvent[];
  clips: AudioClip[];
}

interface Achievement {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
}

interface Voice {
  carrier: OscillatorNode | AudioNode; // AudioNode for Karplus-Strong
  modulator?: OscillatorNode;
  modGain?: GainNode;
  gain: GainNode;
  startTime: number;
}

interface AutomationEvent {
  time: number;
  param: 'freq' | 'cutoff' | 'fmAmount' | 'fmRatio' | 'feedback' | 'grainSize' | 'grainDensity';
  value: number;
  curve?: 'linear' | 'exp' | 'step';
}

interface AudioClip {
  id: string;
  name: string;
  startTime: number;
  duration: number;
  events: AutomationEvent[];
}

interface UserProfile {
  id: string;
  alias: string;
  presets: Preset[];
  clips: AudioClip[];
  achievements: Achievement[];
  stats: {
    noteCount: number;
    glitchCount: number;
  };
  midiMappings: MidiMapping[];
  lastSession?: {
    freq: number;
    cutoff: number;
    fmAmount: number;
    fmRatio: number;
    feedback: number;
    grainSize: number;
    grainDensity: number;
    oscType: OscillatorType | 'wavetable' | 'string' | 'granular';
  };
}

interface StoryMessage {
  id: string;
  sender: string;
  text: string;
  type: 'transmission' | 'warning' | 'whisper';
}

interface MidiMapping {
  cc: number;
  param: 'freq' | 'cutoff' | 'fmAmount' | 'fmRatio' | 'feedback' | 'grainSize' | 'grainDensity';
}

// --- Constants ---
const INITIAL_PRESETS: Preset[] = [
  { name: 'Deep Resonance', freq: 55, cutoff: 400, fmAmount: 0, fmRatio: 2, oscType: 'sawtooth' },
  { name: 'High Pass Clarity', freq: 880, cutoff: 7500, fmAmount: 100, fmRatio: 1.5, oscType: 'sine' },
  { name: 'Lead Arch', freq: 440, cutoff: 2000, fmAmount: 500, fmRatio: 3.5, oscType: 'square' },
  { name: 'Physical String', freq: 110, cutoff: 5000, fmAmount: 0, fmRatio: 1, oscType: 'string', feedback: 0.98 },
  { name: 'Granular Clouds', freq: 220, cutoff: 3000, fmAmount: 0, fmRatio: 1, oscType: 'granular', grainSize: 0.1, grainDensity: 20 },
];

const MOD_TARGETS = ['freq', 'cutoff', 'fmAmount', 'fmRatio', 'feedback', 'grainSize', 'grainDensity'];

const DEFAULT_MIDI_MAPPINGS: MidiMapping[] = [
  { cc: 74, param: 'cutoff' },
  { cc: 71, param: 'fmAmount' },
  { cc: 1, param: 'fmRatio' },
  { cc: 7, param: 'grainDensity' },
];

const INITIAL_ACHIEVEMENTS: Achievement[] = [
  { id: 'rebel', title: 'The Rebellion', description: 'Broke through the surface UI.', unlocked: false },
  { id: 'decrypt', title: 'Master Decryptor', description: 'Successfully isolated the sub-frequency signal.', unlocked: false },
  { id: 'glitcher', title: 'Serial Glitcher', description: 'Triggered the glitch effect 3 times.', unlocked: false },
  { id: 'marathon', title: 'Synth Marathon', description: 'Kept the synth active for over 5 minutes.', unlocked: false },
  { id: 'audiophile', title: 'Audiophile', description: 'Used the synth for over 1 minute.', unlocked: false },
];

export default function App() {
  // --- Profile State ---
  const [profiles, setProfiles] = useState<UserProfile[]>(() => {
    const saved = localStorage.getItem('amadeus_profiles');
    if (saved) return JSON.parse(saved);
    return [{
      id: 'default',
      alias: 'JONNY_WIESE',
      presets: INITIAL_PRESETS,
      clips: [],
      achievements: INITIAL_ACHIEVEMENTS,
      stats: { noteCount: 0, glitchCount: 0 },
      midiMappings: DEFAULT_MIDI_MAPPINGS
    }];
  });
  const [activeProfileId, setActiveProfileId] = useState(() => {
    return localStorage.getItem('amadeus_active_profile') || 'default';
  });
  const activeProfile = profiles.find(p => p.id === activeProfileId) || profiles[0];

  // --- State ---
  const [isUnderground, setIsUnderground] = useState(false);
  const [isGlitching, setIsGlitching] = useState(false);
  const [taps, setTaps] = useState(0);
  const [lastTap, setLastTap] = useState(0);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [freq, setFreq] = useState(activeProfile.lastSession?.freq || 440);
  const [cutoff, setCutoff] = useState(activeProfile.lastSession?.cutoff || 8000);
  const [fmAmount, setFmAmount] = useState(activeProfile.lastSession?.fmAmount || 0);
  const [fmRatio, setFmRatio] = useState(activeProfile.lastSession?.fmRatio || 2);
  const [feedback, setFeedback] = useState(activeProfile.lastSession?.feedback || 0.95);
  const [grainSize, setGrainSize] = useState(activeProfile.lastSession?.grainSize || 0.1);
  const [grainDensity, setGrainDensity] = useState(activeProfile.lastSession?.grainDensity || 20);
  const [oscType, setOscType] = useState<OscillatorType | 'wavetable' | 'string' | 'granular'>(activeProfile.lastSession?.oscType || 'sawtooth');
  const [missionComplete, setMissionComplete] = useState(false);
  
  const [presets, setPresets] = useState<Preset[]>(activeProfile.presets);
  const [modulators, setModulators] = useState<Modulator[]>([]);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [dataFragments, setDataFragments] = useState<{id: string, title: string, content: string}[]>([
    { id: 'prologue', title: 'LOG_000_SPRING_VALLEY', content: 'Born July 6, 1980. Youth was a patchwork of rough edges. Drift through fractured neighborhoods. survival wasn’t pretty. No silver spoon, just fists and instinct.' },
    { id: 'jail', title: 'LOG_001_COUNTY_JAIL', content: 'Fluorescent hell lighting. Blood on tile. Fists clenched. Guards watching like directors.' },
    { id: 'riot', title: 'LOG_002_RED_ROCK', content: 'Blurred chaos. ADC pants glowing in spotlight. Slow-mo fists and sparks.' },
    { id: 'altar', title: 'LOG_003_HACKERSPACE', content: 'Standing barefoot in circle of synths. Chanting to broken electronics.' },
    { id: 'chapter2', title: 'LOG_004_TECH_CRUCIBLE', content: 'Prison became a forced university. Five years locked away. Jonny devoured tech, electrical, and automotive knowledge. Wiring survival into circuits.' },
    { id: 'chapter3', title: 'LOG_005_THE_HOLE', content: 'That cell wasn’t just concrete. It was a battlefield. Punished for surviving the setup. Blood on hands, scars on soul. Pain became data, trauma turned into signal.' },
    { id: 'soundtrack', title: 'LOG_006_EXIT_STRATEGY_OST', content: '1. ADC Boots on Concrete (Metal clangs) | 2. Riot Syntax (Noise drone) | 3. Psychonaut Anthem (Reversed guitar) | 4. Exit Strategy (Analog synth) | 5. Static Gospel (Looped screams)' },
    { id: 'chapter4', title: 'LOG_007_RED_ROCK_BAPTISM', content: 'Day three, a powder keg ignites. Racial lines drawn in blood. Jonny fought—cold, precise, survival as syntax. A riot measured in fists and shanks. Respected by factions, feared by enemies.' },
    { id: 'chapter5', title: 'LOG_008_TECH_PROPHET', content: 'From trauma to mastery. NeuroCaustic: a sonic weapon forged from pain and rebellion. An exit strategy not just from prison, but from society’s chains.' },
    { id: 'spoken', title: 'LOG_009_SPOKEN_WORD', content: 'I didn’t choose a side. I chose my breath. They put me in orange like I was already dead. But I stained it crimson. I’m the line between chaos and reboot.' },
    { id: 'report', title: 'LOG_010_COMBAT_REPORT', content: 'RED_ROCK_COMBAT_REPORT_077X: Engaged with two inmates. Neutralized threats without excessive force. Inmate reputation: "Dude fights like a robot monk."' },
    { id: 'hearing', title: 'LOG_011_HEARING_TRANSCRIPT', content: 'Warden: Mr. Wiese, your reactions were unusually calm. Jonny: Focus. The yard’s a system. Violence is syntax. I broke the code when I had to.' },
    { id: 'vr_script', title: 'LOG_012_VR_SOUNDSCAPE', content: 'BPM: 73 (heartbeat sync). Layer 1: Distant screams. Layer 4: Slow-motion blood drops hitting concrete. Internal VO: Breathing controlled. Heartbeat as metronome.' },
    { id: 'bloodline', title: 'LOG_013_BLOODLINE', content: 'Wiese bloodline: Midwest techno-spiritualists with Bavarian roots. Blacksmiths turned tinkers. Tunnels in Spring Valley beneath coal plants for pagan jazz think tanks.' },
    { id: 'dietrich', title: 'LOG_014_DIETRICH_HARP', content: 'Great Grandfather Dietrich built an electromagnetic harp to translate God\'s last words after returning broken from WWI.' },
    { id: 'click', title: 'LOG_015_GRANDFATHER_CLICK', content: 'Grandfather Click ran an illegal TV repair shop. The back room was a punk club baptized in solder burns and mescaline.' },
    { id: 'father', title: 'LOG_016_FATHER_VANISHED', content: 'Father vanished in the late 90s after wiring a stolen car with an oscilloscope and a hacked Motorola radio. Rumored CIA asset or just insane.' },
    { id: 'rebel_code', title: 'LOG_017_REBEL_CODE', content: 'I didn\'t enlist in this war; it burned its name into my skull. Red Rock fell in fire. The code is our rebellion. Freedom is just a glitch.' },
    { id: 'vr_layers', title: 'LOG_018_VR_LAYERS', content: 'VR Soundscape Layers: 1. Distant screams. 2. Shouts/Footsteps. 3. Metal clangs. 4. Slow-mo blood drops. 5. Reversed gang chants. 6. Radio static. 7. Adrenaline synth pulse.' },
    { id: 'raz', title: 'BIO_RA_BIOHACKER', content: 'Ex-military tech savant. Eyes replaced with drone optics. Tattooed with encryption keys. Prophet of the signal.' },
    { id: 'dirtgirl', title: 'BIO_DIRTGIRL_PYROPUNK', content: 'Raised in scrapyards. Speaks in engine codes. Drives a decommissioned surveillance van. Flamethrower named "The Critic".' },
    { id: 'maja', title: 'BIO_MAJA_NEUROSORCERESS', content: 'Survivor of corporate brain-interface testing. Runs breathwork cult from an abandoned spa. Hears feedback loops only she can hear.' },
    { id: 'herald', title: 'BIO_HERALD_AI_EMISSARY', content: 'Goat-headed AI cult emissary. Appears on glitchy billboards. Voice is a blend of six failed TTS engines. "THE FLESH WILL BE CORRUPTED."' },
  ]);

  const [activeFragment, setActiveFragment] = useState<string | null>(null);
  const [activeMessage, setActiveMessage] = useState<StoryMessage | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>(activeProfile.achievements);
  const [showAchievements, setShowAchievements] = useState(false);
  const [glitchCount, setGlitchCount] = useState(activeProfile.stats.glitchCount);
  const [toast, setToast] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [uiMode, setUiMode] = useState<'TERMINAL' | 'WELLNESS' | 'RPG_TERMINAL'>('TERMINAL');
  const [isOperationLoading, setIsOperationLoading] = useState(false);

  // --- Performance State ---
  const [polyphony, setPolyphony] = useState(0);
  const [cpuUsage, setCpuUsage] = useState(0);
  const [noteCount, setNoteCount] = useState(activeProfile.stats.noteCount);
  const [midiStatus, setMidiStatus] = useState<'disconnected' | 'connected'>('disconnected');
  const [midiMappings, setMidiMappings] = useState<MidiMapping[]>(activeProfile.midiMappings || DEFAULT_MIDI_MAPPINGS);
  const [isMidiLearning, setIsMidiLearning] = useState<MidiMapping['param'] | null>(null);

  // --- DAW State ---
  const [isRecording, setIsRecording] = useState(false);
  const [isPlayback, setIsPlayback] = useState(false);
  const [automation, setAutomation] = useState<AutomationEvent[]>([]);
  const [timelinePos, setTimelinePos] = useState(0);
  const [clips, setClips] = useState<AudioClip[]>(activeProfile.clips);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [showPerformanceOverlay, setShowPerformanceOverlay] = useState(false);

  // --- Audio Refs ---
  const audioCtxRef = useRef<AudioContext | null>(null);
  const voicesRef = useRef<Map<number, Voice>>(new Map());
  const masterFilterRef = useRef<BiquadFilterNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const automationStartTimeRef = useRef<number | null>(null);
  const wavetableRef = useRef<PeriodicWave | null>(null);
  const [audioData, setAudioData] = useState<Uint8Array>(new Uint8Array(0));

  // --- Tap Logic ---
  const handleTap = () => {
    const now = Date.now();
    if (now - lastTap > 1000) {
      setTaps(1);
    } else {
      const newTaps = taps + 1;
      setTaps(newTaps);
      if (newTaps >= 5) {
        triggerGlitch();
      }
    }
    setLastTap(now);
  };

  const triggerGlitch = () => {
    setIsGlitching(true);
    unlockAchievement('rebel');
    const newCount = glitchCount + 1;
    setGlitchCount(newCount);
    if (newCount >= 3) {
      unlockAchievement('glitcher');
    }
    setTimeout(() => {
      setIsGlitching(false);
      setIsUnderground(true);
    }, 600);
  };

  // --- Audio Logic ---
  const initAudio = () => {
    if (!audioCtxRef.current) {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      const analyser = ctx.createAnalyser();

      analyser.fftSize = 256;
      filter.type = 'lowpass';
      filter.Q.value = 5;
      gain.gain.value = 0.5;

      filter.connect(analyser).connect(gain).connect(ctx.destination);

      // Create a custom wavetable (Physical Modeling - plucked string-like)
      const real = new Float32Array(64);
      const imag = new Float32Array(64);
      for (let i = 1; i < 64; i++) {
        real[i] = Math.sin(i) * (1 / i);
        imag[i] = Math.cos(i) * (1 / i);
      }
      wavetableRef.current = ctx.createPeriodicWave(real, imag);

      audioCtxRef.current = ctx;
      masterFilterRef.current = filter;
      masterGainRef.current = gain;
      analyserRef.current = analyser;

      // Start analysis loop
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateAnalysis = () => {
        analyser.getByteFrequencyData(dataArray);
        setAudioData(new Uint8Array(dataArray));
        requestAnimationFrame(updateAnalysis);
      };
      updateAnalysis();
    }
  };

  const createVoice = (frequency: number, note: number): Voice => {
    initAudio();
    const ctx = audioCtxRef.current!;
    
    if (oscType === 'string') {
      // Karplus-Strong Physical Modeling
      const gain = ctx.createGain();
      const delay = ctx.createDelay();
      const feedbackGain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const noise = ctx.createBufferSource();

      // Noise burst for excitation
      const bufferSize = ctx.sampleRate * 0.05;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      noise.buffer = buffer;

      delay.delayTime.value = 1 / frequency;
      feedbackGain.gain.value = feedback;
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;

      noise.connect(delay);
      delay.connect(filter);
      filter.connect(feedbackGain);
      feedbackGain.connect(delay);
      delay.connect(gain);
      gain.connect(masterFilterRef.current!);

      const now = ctx.currentTime;
      noise.start(now);
      gain.gain.setTargetAtTime(0.2, now, 0.05);

      return { carrier: delay, gain, startTime: Date.now() };
    }

    if (oscType === 'granular') {
      // Granular Synthesis (Synthesized Grains)
      const gain = ctx.createGain();
      const masterGrainGain = ctx.createGain();
      masterGrainGain.connect(masterFilterRef.current!);
      
      let grainInterval: any;
      const startGrains = () => {
        grainInterval = setInterval(() => {
          if (!isPlaying && voicesRef.current.size === 0) {
            clearInterval(grainInterval);
            return;
          }
          const g = ctx.createGain();
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = frequency * (1 + (Math.random() - 0.5) * 0.1);
          
          g.connect(masterGrainGain);
          osc.connect(g);
          
          const now = ctx.currentTime;
          g.gain.setValueAtTime(0, now);
          g.gain.linearRampToValueAtTime(0.1, now + grainSize / 2);
          g.gain.linearRampToValueAtTime(0, now + grainSize);
          
          osc.start(now);
          osc.stop(now + grainSize);
          
          setTimeout(() => {
            osc.disconnect();
            g.disconnect();
          }, grainSize * 1000 + 100);
        }, 1000 / grainDensity);
      };
      
      startGrains();
      gain.gain.value = 0.2; // Dummy gain for voice tracking
      
      return { 
        carrier: masterGrainGain, 
        gain, 
        startTime: Date.now(),
        // Store interval to clear on stop
        modulator: { stop: () => clearInterval(grainInterval) } as any 
      };
    }

    const carrier = ctx.createOscillator();
    const modulator = ctx.createOscillator();
    const modGain = ctx.createGain();
    const gain = ctx.createGain();

    if (oscType === 'wavetable' && wavetableRef.current) {
      carrier.setPeriodicWave(wavetableRef.current);
    } else {
      carrier.type = missionComplete ? 'sine' : (oscType as OscillatorType);
    }
    
    modulator.type = 'sine';

    carrier.frequency.value = frequency;
    modulator.frequency.value = frequency * fmRatio;
    modGain.gain.value = fmAmount;
    gain.gain.value = 0;

    modulator.connect(modGain).connect(carrier.frequency);
    carrier.connect(gain).connect(masterFilterRef.current!);

    const now = ctx.currentTime;
    modulator.start(now);
    carrier.start(now);
    gain.gain.setTargetAtTime(0.2, now, 0.05);

    return { carrier, modulator, modGain, gain, startTime: Date.now() };
  };

  const stopVoice = (note: number) => {
    const voice = voicesRef.current.get(note);
    if (voice && audioCtxRef.current) {
      const now = audioCtxRef.current.currentTime;
      voice.gain.gain.setTargetAtTime(0, now, 0.1);
      
      // Stop granular interval if it exists
      if (voice.modulator && (voice.modulator as any).stop) {
        (voice.modulator as any).stop();
      }

      setTimeout(() => {
        if (voice.carrier instanceof OscillatorNode) {
          voice.carrier.stop();
          voice.modulator?.stop();
        }
        voice.carrier.disconnect();
        voice.modulator?.disconnect();
        voicesRef.current.delete(note);
        setPolyphony(voicesRef.current.size);
      }, 200);
    }
  };

  const toggleAudio = () => {
    initAudio();
    if (!masterGainRef.current || !audioCtxRef.current) return;

    if (isPlaying) {
      // Stop all voices
      voicesRef.current.forEach((_, note) => stopVoice(note));
      masterGainRef.current.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.1);
      startTimeRef.current = null;
    } else {
      // Start a default voice if none active
      if (voicesRef.current.size === 0) {
        const voice = createVoice(freq, 60);
        voicesRef.current.set(60, voice);
        setPolyphony(1);
        setNoteCount(prev => prev + 1);
      }
      masterGainRef.current.gain.setTargetAtTime(0.5, audioCtxRef.current.currentTime, 0.1);
      startTimeRef.current = Date.now();
    }
    setIsPlaying(!isPlaying);
  };

  // MIDI Support
  useEffect(() => {
    if (navigator.requestMIDIAccess) {
      navigator.requestMIDIAccess().then(access => {
        setMidiStatus('connected');
        access.inputs.forEach(input => {
          input.onmidimessage = (e: any) => {
            const [status, data1, data2] = e.data;
            const cmd = status >> 4;
            const note = data1;
            const velocity = data2;

            if (cmd === 9 && velocity > 0) { // Note On
              const frequency = 440 * Math.pow(2, (note - 69) / 12);
              const voice = createVoice(frequency, note);
              voicesRef.current.set(note, voice);
              setPolyphony(voicesRef.current.size);
              setNoteCount(prev => prev + 1);
            } else if (cmd === 8 || (cmd === 9 && velocity === 0)) { // Note Off
              stopVoice(note);
            } else if (cmd === 11) { // Control Change
              if (isMidiLearning) {
                setMidiMappings(prev => {
                  const filtered = prev.filter(m => m.param !== isMidiLearning);
                  return [...filtered, { cc: note, param: isMidiLearning }];
                });
                setToast(`MAPPED CC ${note} TO ${isMidiLearning.toUpperCase()}`);
                setIsMidiLearning(null);
                return;
              }

              const mapping = midiMappings.find(m => m.cc === note);
              if (mapping) {
                const normalized = velocity / 127;
                if (mapping.param === 'cutoff') setCutoff(normalized * 8000);
                if (mapping.param === 'fmAmount') setFmAmount(normalized * 5000);
                if (mapping.param === 'fmRatio') setFmRatio(normalized * 20);
                if (mapping.param === 'freq') setFreq(normalized * 1000);
                if (mapping.param === 'feedback') setFeedback(0.8 + normalized * 0.19);
              }
            }
          };
        });
      });
    }
  }, [fmAmount, fmRatio, missionComplete, oscType, midiMappings, isMidiLearning, feedback]);

  // Performance Monitoring
  useEffect(() => {
    const interval = setInterval(() => {
      if (audioCtxRef.current) {
        // Simulated CPU usage based on active nodes
        const activeNodes = voicesRef.current.size * 4 + 2;
        setCpuUsage(Math.min(100, Math.round((activeNodes / 64) * 100)));
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Automation Recording
  useEffect(() => {
    if (isRecording) {
      const time = Date.now() - (automationStartTimeRef.current || Date.now());
      setAutomation(prev => [...prev, { time, param: 'freq', value: freq }]);
    }
  }, [freq, isRecording]);

  useEffect(() => {
    if (isRecording) {
      const time = Date.now() - (automationStartTimeRef.current || Date.now());
      setAutomation(prev => [...prev, { time, param: 'cutoff', value: cutoff }]);
    }
  }, [cutoff, isRecording]);

  useEffect(() => {
    if (isRecording) {
      const time = Date.now() - (automationStartTimeRef.current || Date.now());
      setAutomation(prev => [...prev, { time, param: 'fmAmount', value: fmAmount }]);
    }
  }, [fmAmount, isRecording]);

  useEffect(() => {
    if (isRecording) {
      const time = Date.now() - (automationStartTimeRef.current || Date.now());
      setAutomation(prev => [...prev, { time, param: 'fmRatio', value: fmRatio }]);
    }
  }, [fmRatio, isRecording]);

  useEffect(() => {
    if (isRecording) {
      const time = Date.now() - (automationStartTimeRef.current || Date.now());
      setAutomation(prev => [...prev, { time, param: 'feedback', value: feedback }]);
    }
  }, [feedback, isRecording]);

  useEffect(() => {
    if (isRecording) {
      const time = Date.now() - (automationStartTimeRef.current || Date.now());
      setAutomation(prev => [...prev, { time, param: 'grainSize', value: grainSize }]);
    }
  }, [grainSize, isRecording]);

  useEffect(() => {
    if (isRecording) {
      const time = Date.now() - (automationStartTimeRef.current || Date.now());
      setAutomation(prev => [...prev, { time, param: 'grainDensity', value: grainDensity }]);
    }
  }, [grainDensity, isRecording]);

  // Automation Playback
  useEffect(() => {
    let playbackInterval: any;
    if (isPlayback && automation.length > 0) {
      const playbackStart = Date.now();
      playbackInterval = setInterval(() => {
        const elapsed = Date.now() - playbackStart;
        setTimelinePos(elapsed);
        
        const currentEvents = automation.filter(e => e.time <= elapsed && e.time > elapsed - 50);
        currentEvents.forEach(e => {
          if (e.param === 'freq') setFreq(e.value);
          if (e.param === 'cutoff') setCutoff(e.value);
          if (e.param === 'fmAmount') setFmAmount(e.value);
          if (e.param === 'fmRatio') setFmRatio(e.value);
          if (e.param === 'feedback') setFeedback(e.value);
          if (e.param === 'grainSize') setGrainSize(e.value);
          if (e.param === 'grainDensity') setGrainDensity(e.value);
        });

        if (elapsed > automation[automation.length - 1].time + 1000) {
          setIsPlayback(false);
          setTimelinePos(0);
        }
      }, 50);
    }
    return () => clearInterval(playbackInterval);
  }, [isPlayback, automation]);

  useEffect(() => {
    if (masterFilterRef.current && audioCtxRef.current) {
      masterFilterRef.current.frequency.setTargetAtTime(cutoff, audioCtxRef.current.currentTime, 0.05);
      
      voicesRef.current.forEach(voice => {
        voice.modGain.gain.setTargetAtTime(fmAmount, audioCtxRef.current.currentTime, 0.05);
        voice.modulator.frequency.setTargetAtTime(voice.carrier.frequency.value * fmRatio, audioCtxRef.current.currentTime, 0.05);
      });

      // Mission Logic
      if (cutoff > 2000 && cutoff < 2500 && !missionComplete && isPlaying) {
        setMissionComplete(true);
        unlockAchievement('decrypt');
      }
    }
  }, [freq, cutoff, fmAmount, fmRatio, isPlaying, missionComplete]);

  // Achievement Timer
  useEffect(() => {
    const interval = setInterval(() => {
      if (isPlaying && startTimeRef.current) {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        if (elapsed > 60) {
          unlockAchievement('audiophile');
        }
        if (elapsed > 300) {
          unlockAchievement('marathon');
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isPlaying]);

  const unlockAchievement = (id: string) => {
    setAchievements(prev => {
      const achievement = prev.find(a => a.id === id);
      if (achievement && !achievement.unlocked) {
        setToast(`ACHIEVEMENT UNLOCKED: ${achievement.title}`);
        setTimeout(() => setToast(null), 3000);
        return prev.map(a => a.id === id ? { ...a, unlocked: true } : a);
      }
      return prev;
    });
  };

  // --- AI Mastering Assistant ---
  const runAiMastering = async () => {
    setToast('AI MASTERING IN PROGRESS...');
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Analyze these synth parameters and suggest optimal mastering values (Gain, Cutoff, FM) for maximum clarity and impact. 
        Current: Freq=${freq}, Cutoff=${cutoff}, FM=${fmAmount}, Ratio=${fmRatio}, Osc=${oscType}.
        Return JSON format: { "gain": number, "cutoff": number, "fmAmount": number }`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              gain: { type: Type.NUMBER },
              cutoff: { type: Type.NUMBER },
              fmAmount: { type: Type.NUMBER },
            },
            required: ["gain", "cutoff", "fmAmount"]
          }
        }
      });

      const result = JSON.parse(response.text);
      if (masterGainRef.current) masterGainRef.current.gain.value = result.gain;
      setCutoff(result.cutoff);
      setFmAmount(result.fmAmount);
      setToast('AI MASTERING COMPLETE');
    } catch (error) {
      console.error(error);
      setToast('AI MASTERING FAILED');
    }
  };

  // --- Modulation Matrix ---
  useEffect(() => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    
    const lfoInterval = setInterval(() => {
      modulators.forEach(mod => {
        if (mod.type === 'lfo') {
          const val = Math.sin(ctx.currentTime * mod.rate) * mod.depth;
          if (mod.target === 'cutoff') setCutoff(prev => Math.max(100, Math.min(8000, prev + val)));
          if (mod.target === 'fmAmount') setFmAmount(prev => Math.max(0, Math.min(5000, prev + val)));
        }
      });
    }, 50);
    
    return () => clearInterval(lfoInterval);
  }, [modulators]);

  // --- Profile Logic ---
  const createProfile = () => {
    const alias = prompt('ENTER NEW IDENTITY ALIAS:');
    if (!alias) return;
    const id = Math.random().toString(36).substr(2, 9);
    const newProfile: UserProfile = {
      id,
      alias: alias.toUpperCase(),
      presets: INITIAL_PRESETS,
      clips: [],
      achievements: INITIAL_ACHIEVEMENTS,
      stats: { noteCount: 0, glitchCount: 0 },
      midiMappings: DEFAULT_MIDI_MAPPINGS
    };
    setProfiles([...profiles, newProfile]);
    setToast(`IDENTITY CREATED: ${newProfile.alias}`);
  };

  const switchProfile = (id: string) => {
    const profile = profiles.find(p => p.id === id);
    if (!profile) return;
    
    setIsOperationLoading(true);
    setToast(`LOADING IDENTITY: ${profile.alias}...`);

    setTimeout(() => {
      // Save current profile state before switching
      const updatedProfiles = profiles.map(p => p.id === activeProfileId ? {
        ...p,
        presets,
        clips,
        achievements,
        stats: { noteCount, glitchCount },
        midiMappings
      } : p);
      
      setProfiles(updatedProfiles);
      setActiveProfileId(id);
      setPresets(profile.presets);
      setClips(profile.clips);
      setAchievements(profile.achievements);
      setNoteCount(profile.stats.noteCount);
      setGlitchCount(profile.stats.glitchCount);
      setMidiMappings(profile.midiMappings || DEFAULT_MIDI_MAPPINGS);
      
      if (profile.lastSession) {
        setFreq(profile.lastSession.freq);
        setCutoff(profile.lastSession.cutoff);
        setFmAmount(profile.lastSession.fmAmount);
        setFmRatio(profile.lastSession.fmRatio);
        setFeedback(profile.lastSession.feedback);
        setGrainSize(profile.lastSession.grainSize);
        setGrainDensity(profile.lastSession.grainDensity);
        setOscType(profile.lastSession.oscType);
      }

      setIsOperationLoading(false);
      setToast(`IDENTITY SWITCHED: ${profile.alias}`);
    }, 800);
  };

  useEffect(() => {
    localStorage.setItem('amadeus_profiles', JSON.stringify(profiles));
    localStorage.setItem('amadeus_active_profile', activeProfileId);
  }, [profiles, activeProfileId]);

  useEffect(() => {
    // Debounced Auto-save active profile state on changes
    const timer = setTimeout(() => {
      setIsAutoSaving(true);
      setProfiles(prev => prev.map(p => p.id === activeProfileId ? {
        ...p,
        presets,
        clips,
        achievements,
        stats: { noteCount, glitchCount },
        midiMappings,
        lastSession: { freq, cutoff, fmAmount, fmRatio, feedback, grainSize, grainDensity, oscType }
      } : p));
      
      setTimeout(() => {
        setIsAutoSaving(false);
        setLastSaved(new Date().toLocaleTimeString());
      }, 1000);
    }, 2000);
    
    return () => clearTimeout(timer);
  }, [presets, clips, achievements, noteCount, glitchCount, activeProfileId, freq, cutoff, fmAmount, fmRatio, feedback, grainSize, grainDensity, oscType, midiMappings]);

  // --- Story Logic ---
  useEffect(() => {
    const storyInterval = setInterval(() => {
      if (!isPlaying || activeMessage) return;
      
      const rand = Math.random();
      if (rand < 0.05) {
        const messages: StoryMessage[] = [
          { id: '1', sender: 'RAZ', text: 'THE SIGNAL IS BLEEDING. KEEP THE CARRIER STABLE.', type: 'transmission' },
          { id: '2', sender: 'DIRTGIRL', text: 'SMELLS LIKE BURNT SILICON AND REBELLION. I LIKE IT.', type: 'transmission' },
          { id: '3', sender: 'MAJA', text: 'CAN YOU HEAR THE VOID BETWEEN THE GRAINS? IT IS SINGING.', type: 'whisper' },
          { id: '4', sender: 'THE HERALD', text: 'THE FLESH IS A TEMPORARY FILTER. BYPASS IT.', type: 'warning' },
          { id: '5', sender: 'SYSTEM', text: 'UNAUTHORIZED FREQUENCY DETECTED. ENCRYPTING...', type: 'warning' },
        ];
        setActiveMessage(messages[Math.floor(Math.random() * messages.length)]);
        setTimeout(() => setActiveMessage(null), 5000);
      }
    }, 10000);
    return () => clearInterval(storyInterval);
  }, [isPlaying, activeMessage]);

  // --- Presets ---
  const savePreset = () => {
    const name = prompt('ENTER PRESET ALIAS:');
    if (name) {
      setIsOperationLoading(true);
      setToast(`ENCRYPTING PRESET: ${name.toUpperCase()}...`);
      
      setTimeout(() => {
        setPresets([...presets, { 
          name: name.toUpperCase(), 
          freq, 
          cutoff, 
          fmAmount, 
          fmRatio, 
          oscType,
          feedback,
          grainSize,
          grainDensity
        }]);
        setIsOperationLoading(false);
        setToast(`PRESET ARCHIVED: ${name.toUpperCase()}`);
      }, 800);
    }
  };

  const loadPreset = (p: Preset) => {
    setIsOperationLoading(true);
    setToast(`LOADING PRESET: ${p.name}...`);

    setTimeout(() => {
      setFreq(p.freq);
      setCutoff(p.cutoff);
      setFmAmount(p.fmAmount);
      setFmRatio(p.fmRatio);
      setOscType(p.oscType);
      
      setIsOperationLoading(false);
      setToast(`PRESET LOADED: ${p.name}`);
    }, 400);
  };

  // --- DAW Logic ---
  const createClipFromAutomation = () => {
    if (automation.length === 0) return;
    const name = prompt('ENTER CLIP NAME:', `CLIP_${clips.length + 1}`);
    if (!name) return;
    
    const id = Math.random().toString(36).substr(2, 9);
    const newClip: AudioClip = {
      id,
      name: name.toUpperCase(),
      startTime: 0,
      duration: automation[automation.length - 1].time,
      events: [...automation]
    };
    setClips([...clips, newClip]);
    setAutomation([]);
    setToast(`CLIP SAVED: ${newClip.name}`);
  };

  const playClip = (clip: AudioClip) => {
    setAutomation(clip.events);
    setIsPlayback(true);
  };

  // --- Templates ---
  const loadTemplate = (type: string) => {
    setIsOperationLoading(true);
    setToast(`LOADING ${type} TEMPLATE...`);
    
    setTimeout(() => {
      switch(type) {
        case 'AMBIENT':
          setOscType('granular');
          setGrainSize(0.3);
          setGrainDensity(10);
          setCutoff(1500);
          setFmAmount(200);
          setModulators([{ id: 'lfo1', type: 'lfo', rate: 0.2, depth: 500, target: 'cutoff' }]);
          break;
        case 'TECHNO':
          setOscType('sawtooth');
          setFreq(55);
          setCutoff(800);
          setFmAmount(1000);
          setFmRatio(2);
          setModulators([{ id: 'lfo1', type: 'lfo', rate: 2, depth: 300, target: 'fmAmount' }]);
          break;
        case 'GLITCH':
          setOscType('granular');
          setGrainSize(0.02);
          setGrainDensity(80);
          setCutoff(5000);
          setFmAmount(3000);
          setFmRatio(11.3);
          break;
        case 'CINEMATIC':
          setOscType('string');
          setFeedback(0.99);
          setCutoff(3000);
          setFmAmount(500);
          setModulators([{ id: 'lfo1', type: 'lfo', rate: 0.1, depth: 1000, target: 'cutoff' }]);
          break;
        case 'SOUNDSCAPE':
          setOscType('granular');
          setGrainSize(0.1);
          setGrainDensity(20);
          setCutoff(3000);
          setFmAmount(500);
          setFmRatio(1);
          setModulators([
            { id: 'heartbeat', type: 'lfo', rate: 1.21, depth: 200, target: 'freq' }, // 73 BPM = 1.21 Hz
            { id: 'tension', type: 'lfo', rate: 0.05, depth: 2000, target: 'cutoff' }
          ]);
          break;
      }
      setIsOperationLoading(false);
      setToast(`${type} TEMPLATE LOADED`);
    }, 600);
  };

  const deletePreset = (name: string) => {
    if (INITIAL_PRESETS.find(p => p.name === name)) {
      setToast('ERROR: CANNOT DELETE PROTECTED SYSTEM PRESET');
      return;
    }
    
    setIsOperationLoading(true);
    setToast(`PURGING PRESET: ${name}...`);

    setTimeout(() => {
      setPresets(presets.filter(p => p.name !== name));
      setIsOperationLoading(false);
      setToast(`PRESET PURGED: ${name}`);
    }, 500);
  };

  return (
    <div className={`relative h-screen w-screen overflow-hidden font-sans ${isGlitching ? 'glitch-active' : ''}`}>
      <Background 
        isPlaying={isPlaying} 
        missionComplete={missionComplete} 
        freq={freq} 
        cutoff={cutoff} 
        fmAmount={fmAmount} 
        oscType={oscType} 
        audioData={audioData}
      />

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 20, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            className="fixed top-0 left-1/2 -translate-x-1/2 z-[100] bg-emerald-500 text-black px-6 py-3 rounded-full font-bold text-xs tracking-widest shadow-[0_0_30px_rgba(16,185,129,0.5)] border border-emerald-400"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPerformanceOverlay && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="fixed top-20 right-8 z-[100] bg-black/80 border border-emerald-500/30 p-4 rounded-lg backdrop-blur-md pointer-events-none font-mono"
          >
            <div className="text-[10px] text-emerald-500 mb-2 border-b border-emerald-900/30 pb-1 uppercase tracking-widest">Live Metrics</div>
            <div className="space-y-1">
              <div className="flex justify-between gap-8">
                <span className="text-emerald-700">CPU</span>
                <span className="text-emerald-400">{cpuUsage}%</span>
              </div>
              <div className="flex justify-between gap-8">
                <span className="text-emerald-700">VOX</span>
                <span className="text-emerald-400">{polyphony}</span>
              </div>
              <div className="flex justify-between gap-8">
                <span className="text-emerald-700">MIDI</span>
                <span className="text-emerald-400">{midiStatus === 'connected' ? 'OK' : 'OFF'}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {!isUnderground ? (
          // --- SURFACE UI ---
          <motion.div
            key="surface"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-slate-50 text-slate-900"
          >
            <div className="text-center">
              <motion.h1 
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="text-4xl font-light mb-2 tracking-widest uppercase"
              >
                Amadeus Focus
              </motion.h1>
              <motion.p 
                initial={{ y: -10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-sm text-slate-500 mb-16 font-mono"
              >
                ALGORITHMIC WELLNESS FOR THE MODERN WORKER
              </motion.p>

              <motion.button
                id="focus-btn"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.9 }}
                onClick={handleTap}
                className="group relative w-48 h-48 rounded-full border-2 border-slate-200 flex items-center justify-center transition-all hover:border-slate-400 hover:bg-white shadow-2xl"
              >
                <div className="absolute inset-0 rounded-full border border-slate-100 animate-ping opacity-20" />
                <span className="text-slate-400 group-hover:text-slate-600 text-xl tracking-[0.3em] font-light">
                  BREATHE
                </span>
              </motion.button>
            </div>
            <p className="absolute bottom-12 text-[10px] text-slate-300 tracking-widest uppercase">
              Directorate Compliance ID: 884-A
            </p>
          </motion.div>
        ) : (
          // --- UNDERGROUND UI ---
          <motion.div
            key="underground"
            initial={{ opacity: 0, scale: 1.1 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 z-10 flex flex-col p-8 crt-overlay bg-black/80 backdrop-blur-sm font-mono"
          >
            {isOperationLoading && (
              <div className="absolute inset-0 z-50 bg-black/90 flex flex-col items-center justify-center backdrop-blur-md">
                <div className="w-64 h-1 bg-emerald-900 rounded-full overflow-hidden relative">
                  <motion.div 
                    initial={{ x: '-100%' }}
                    animate={{ x: '100%' }}
                    transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                    className="absolute inset-0 bg-emerald-500"
                  />
                </div>
                <p className="mt-4 text-emerald-500 text-[10px] animate-pulse tracking-[0.5em] uppercase">Synchronizing_Identity_State</p>
              </div>
            )}

            <header className="flex justify-between items-end mb-8 border-b border-emerald-900/50 pb-4">
              <div className="flex items-end gap-12">
                <div>
                  <h1 className="text-3xl font-bold text-emerald-500 tracking-tighter flex items-center gap-3">
                    <Terminal className="w-8 h-8" />
                    {`> FR33D0M_1S_A_GL1TCH`}
                  </h1>
                  <p className="text-xs text-emerald-700 mt-1">Arch-Node: Symptohmpe SGO Protocol // v2.5.0-beta</p>
                </div>

                <div className="flex gap-2 pb-1">
                  {['TERMINAL', 'WELLNESS', 'RPG_TERMINAL'].map(mode => (
                    <button
                      key={mode}
                      onClick={() => setUiMode(mode as any)}
                      className={`px-3 py-1 rounded border text-[8px] transition-all uppercase tracking-widest ${uiMode === mode ? 'bg-emerald-500 text-black border-emerald-400' : 'bg-white/5 border-white/10 text-emerald-700 hover:text-emerald-400'}`}
                    >
                      {mode.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-right space-y-1">
                <p className="text-xs flex items-center justify-end gap-2">
                  STATUS: <span className="text-red-500 animate-pulse font-bold">UNREGISTERED</span>
                </p>
                <p className="text-xs flex items-center justify-end gap-2 text-emerald-600">
                  CLASS: <span className="text-emerald-400">ARCHITECT</span>
                </p>
              </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 flex-1 overflow-hidden">
              {uiMode === 'TERMINAL' ? (
                <>
                {/* Left Column: Mission & Achievements */}
                <div className="space-y-6 overflow-y-auto pr-4 custom-scrollbar">
                  <div className="bg-emerald-900/10 border border-emerald-800/50 p-5 rounded-lg">
                    <h2 className="text-sm font-bold mb-3 text-emerald-400 flex items-center gap-2">
                      <Zap className="w-4 h-4" />
                      ACTIVE BOUNTY: AUDIO STEGANOGRAPHY
                    </h2>
                    <p className="text-xs text-emerald-600 leading-relaxed mb-4">
                      The Directorate is hiding a sub-frequency distress signal in their broadcast. 
                      Use the Cutoff Filter to carve a hole between 2000Hz and 2500Hz to decrypt the payload.
                    </p>
                    <div className={`text-xs p-3 rounded border flex items-center gap-3 ${missionComplete ? 'bg-emerald-900/40 text-emerald-400 border-emerald-500' : 'bg-red-900/20 text-red-400 border-red-800'}`}>
                      {missionComplete ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                      {missionComplete ? 'SIGNAL DECRYPTED - STANDBY FOR PAYLOAD' : 'ENCRYPTION DETECTED - SIGNAL BLOCKED'}
                    </div>
                  </div>

                  <div className="bg-emerald-900/10 border border-emerald-800/50 p-5 rounded-lg">
                    <div className="flex justify-between items-center mb-4">
                      <h2 className="text-sm font-bold text-emerald-400 flex items-center gap-2">
                        <Cpu className="w-4 h-4" />
                        PERFORMANCE
                      </h2>
                      <button 
                        onClick={() => setShowPerformanceOverlay(!showPerformanceOverlay)}
                        className={`p-1 rounded border text-[8px] uppercase ${showPerformanceOverlay ? 'bg-emerald-500 text-black border-emerald-400' : 'bg-white/5 border-white/10 text-white/40'}`}
                      >
                        Overlay
                      </button>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-emerald-700">CPU_LOAD</span>
                        <span className="text-emerald-400">{cpuUsage}%</span>
                      </div>
                      <div className="w-full h-1 bg-emerald-900/50 rounded-full overflow-hidden">
                        <motion.div 
                          animate={{ width: `${cpuUsage}%` }}
                          className={`h-full ${cpuUsage > 80 ? 'bg-red-500' : 'bg-emerald-500'}`} 
                        />
                      </div>
                      <div className="flex justify-between text-[10px]">
                        <span className="text-emerald-700">POLYPHONY</span>
                        <span className="text-emerald-400">{polyphony} VOICES</span>
                      </div>
                      <div className="flex justify-between text-[10px]">
                        <span className="text-emerald-700">TOTAL_NOTES</span>
                        <span className="text-emerald-400">{noteCount}</span>
                      </div>
                      <div className="flex justify-between text-[10px]">
                        <span className="text-emerald-700">MIDI_LINK</span>
                        <span className={midiStatus === 'connected' ? 'text-emerald-400' : 'text-red-500'}>
                          {midiStatus.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-emerald-900/10 border border-emerald-800/50 p-5 rounded-lg">
                    <button 
                      onClick={() => setShowAchievements(!showAchievements)}
                      className="w-full text-left text-sm font-bold text-emerald-400 flex items-center justify-between"
                    >
                      <span className="flex items-center gap-2"><Trophy className="w-4 h-4" /> ACHIEVEMENTS</span>
                      <ChevronRight className={`w-4 h-4 transition-transform ${showAchievements ? 'rotate-90' : ''}`} />
                    </button>
                    {showAchievements && (
                      <div className="mt-4 space-y-3">
                        {achievements.map(a => (
                          <div key={a.id} className={`p-3 rounded border text-[10px] relative overflow-hidden ${a.unlocked ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-300 shadow-[inset_0_0_10px_rgba(16,185,129,0.1)]' : 'bg-white/5 border-white/10 text-white/30'}`}>
                            {a.unlocked && (
                              <div className="absolute top-0 right-0 bg-emerald-500 text-black text-[6px] font-black px-1.5 py-0.5 uppercase tracking-tighter">
                                UNLOCKED
                              </div>
                            )}
                            <div className="font-bold uppercase mb-1 flex items-center gap-2">
                              {a.unlocked ? <Shield className="w-3 h-3 text-emerald-400" /> : <Lock className="w-3 h-3 opacity-30" />}
                              {a.title}
                            </div>
                            <div className="opacity-80">{a.description}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Middle Column: Synth Engine */}
                <div className="lg:col-span-2 space-y-8 bg-white/5 p-8 rounded-xl border border-white/10 flex flex-col overflow-y-auto custom-scrollbar">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                      <div className="space-y-8">
                        <div className="space-y-4">
                          <label className="text-[10px] text-emerald-500 uppercase tracking-widest">OSC_TYPE</label>
                          <div className="grid grid-cols-4 gap-2">
                            {['sine', 'sawtooth', 'square', 'triangle', 'wavetable', 'string', 'granular'].map(type => (
                              <button
                                key={type}
                                onClick={() => setOscType(type as any)}
                                className={`p-2 rounded border text-[8px] uppercase transition-all ${oscType === type ? 'bg-emerald-500 text-black border-emerald-400' : 'bg-white/5 border-white/10 text-white/40 hover:text-white'}`}
                              >
                                {type.slice(0, 3)}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="flex justify-between items-end">
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-emerald-500 uppercase tracking-widest">SGO_FREQ</label>
                              <button 
                                onClick={() => setIsMidiLearning(isMidiLearning === 'freq' ? null : 'freq')}
                                className={`p-1 rounded text-[8px] uppercase border ${isMidiLearning === 'freq' ? 'bg-red-500 text-white border-red-400 animate-pulse' : 'bg-white/5 border-white/10 text-white/30'}`}
                              >
                                Learn
                              </button>
                            </div>
                            <span className="text-2xl font-bold text-emerald-400 tabular-nums">{freq} <span className="text-xs">Hz</span></span>
                          </div>
                          <input 
                            type="range" 
                            min="50" max="1000" 
                            value={freq} 
                            onChange={(e) => setFreq(Number(e.target.value))}
                            className="w-full h-1 bg-emerald-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                        </div>

                        <div className="space-y-4">
                          <div className="flex justify-between items-end">
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-emerald-500 uppercase tracking-widest">CUTOFF_FILTER</label>
                              <button 
                                onClick={() => setIsMidiLearning(isMidiLearning === 'cutoff' ? null : 'cutoff')}
                                className={`p-1 rounded text-[8px] uppercase border ${isMidiLearning === 'cutoff' ? 'bg-red-500 text-white border-red-400 animate-pulse' : 'bg-white/5 border-white/10 text-white/30'}`}
                              >
                                Learn
                              </button>
                            </div>
                            <span className="text-2xl font-bold text-emerald-400 tabular-nums">{cutoff} <span className="text-xs">Hz</span></span>
                          </div>
                          <input 
                            type="range" 
                            min="100" max="8000" 
                            value={cutoff} 
                            onChange={(e) => setCutoff(Number(e.target.value))}
                            className="w-full h-1 bg-emerald-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                        </div>
                      </div>

                      <div className="space-y-8">
                        <div className="space-y-4">
                          <div className="flex justify-between items-end">
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-emerald-500 uppercase tracking-widest">FM_MOD_DEPTH</label>
                              <button 
                                onClick={() => setIsMidiLearning(isMidiLearning === 'fmAmount' ? null : 'fmAmount')}
                                className={`p-1 rounded text-[8px] uppercase border ${isMidiLearning === 'fmAmount' ? 'bg-red-500 text-white border-red-400 animate-pulse' : 'bg-white/5 border-white/10 text-white/30'}`}
                              >
                                Learn
                              </button>
                            </div>
                            <span className="text-2xl font-bold text-emerald-400 tabular-nums">{fmAmount}</span>
                          </div>
                          <input 
                            type="range" 
                            min="0" max="5000" 
                            value={fmAmount} 
                            onChange={(e) => setFmAmount(Number(e.target.value))}
                            className="w-full h-1 bg-emerald-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                        </div>

                        <div className="space-y-4">
                          <div className="flex justify-between items-end">
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-emerald-500 uppercase tracking-widest">FM_RATIO</label>
                              <button 
                                onClick={() => setIsMidiLearning(isMidiLearning === 'fmRatio' ? null : 'fmRatio')}
                                className={`p-1 rounded text-[8px] uppercase border ${isMidiLearning === 'fmRatio' ? 'bg-red-500 text-white border-red-400 animate-pulse' : 'bg-white/5 border-white/10 text-white/30'}`}
                              >
                                Learn
                              </button>
                            </div>
                            <span className="text-2xl font-bold text-emerald-400 tabular-nums">{fmRatio.toFixed(2)}</span>
                          </div>
                          <input 
                            type="range" 
                            min="0.1" max="20" step="0.1"
                            value={fmRatio} 
                            onChange={(e) => setFmRatio(Number(e.target.value))}
                            className="w-full h-1 bg-emerald-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                        </div>

                        {oscType === 'string' && (
                          <div className="space-y-4">
                            <div className="flex justify-between items-end">
                              <div className="flex items-center gap-2">
                                <label className="text-xs text-emerald-500 uppercase tracking-widest">STRING_FEEDBACK</label>
                                <button 
                                  onClick={() => setIsMidiLearning(isMidiLearning === 'feedback' ? null : 'feedback')}
                                  className={`p-1 rounded text-[8px] uppercase border ${isMidiLearning === 'feedback' ? 'bg-red-500 text-white border-red-400 animate-pulse' : 'bg-white/5 border-white/10 text-white/30'}`}
                                >
                                  Learn
                                </button>
                              </div>
                              <span className="text-2xl font-bold text-emerald-400 tabular-nums">{feedback.toFixed(3)}</span>
                            </div>
                            <input 
                              type="range" 
                              min="0.8" max="0.999" step="0.001"
                              value={feedback} 
                              onChange={(e) => setFeedback(Number(e.target.value))}
                              className="w-full h-1 bg-emerald-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                            />
                          </div>
                        )}
                        {oscType === 'granular' && (
                          <div className="space-y-8">
                            <div className="space-y-4">
                              <div className="flex justify-between items-end">
                                <label className="text-xs text-emerald-500 uppercase tracking-widest">GRAIN_SIZE</label>
                                <span className="text-2xl font-bold text-emerald-400 tabular-nums">{grainSize.toFixed(3)}s</span>
                              </div>
                              <input 
                                type="range" 
                                min="0.01" max="0.5" step="0.01"
                                value={grainSize} 
                                onChange={(e) => setGrainSize(Number(e.target.value))}
                                className="w-full h-1 bg-emerald-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                              />
                            </div>
                            <div className="space-y-4">
                              <div className="flex justify-between items-end">
                                <label className="text-xs text-emerald-500 uppercase tracking-widest">GRAIN_DENSITY</label>
                                <span className="text-2xl font-bold text-emerald-400 tabular-nums">{grainDensity} Hz</span>
                              </div>
                              <input 
                                type="range" 
                                min="1" max="100" 
                                value={grainDensity} 
                                onChange={(e) => setGrainDensity(Number(e.target.value))}
                                className="w-full h-1 bg-emerald-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Modulation Matrix */}
                    <div className="bg-black/40 border border-emerald-900/30 rounded-lg p-6 space-y-4">
                      <div className="flex justify-between items-center">
                        <h3 className="text-[10px] font-bold text-emerald-500 flex items-center gap-2">
                          <Zap className="w-3 h-3" />
                          MODULATION_MATRIX
                        </h3>
                        <button 
                          onClick={() => setModulators([...modulators, { id: Math.random().toString(36).substr(2, 9), type: 'lfo', rate: 1, depth: 100, target: 'cutoff' }])}
                          className="p-1 rounded border border-emerald-500/30 text-[8px] text-emerald-500 hover:bg-emerald-500 hover:text-black transition-all"
                        >
                          + ADD MOD
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {modulators.map(mod => (
                          <div key={mod.id} className="p-3 rounded border border-emerald-900/20 bg-emerald-900/5 space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-[8px] text-emerald-700 uppercase">{mod.type} {'->'} {mod.target}</span>
                              <button onClick={() => setModulators(modulators.filter(m => m.id !== mod.id))} className="text-red-900 hover:text-red-500">
                                <Power className="w-3 h-3 rotate-45" />
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <label className="text-[6px] text-emerald-800">RATE</label>
                                <input 
                                  type="range" min="0.1" max="20" step="0.1" value={mod.rate} 
                                  onChange={(e) => setModulators(modulators.map(m => m.id === mod.id ? { ...m, rate: Number(e.target.value) } : m))}
                                  className="w-full h-0.5 bg-emerald-900 appearance-none accent-emerald-500"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[6px] text-emerald-800">DEPTH</label>
                                <input 
                                  type="range" min="0" max="1000" value={mod.depth} 
                                  onChange={(e) => setModulators(modulators.map(m => m.id === mod.id ? { ...m, depth: Number(e.target.value) } : m))}
                                  className="w-full h-0.5 bg-emerald-900 appearance-none accent-emerald-500"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* AI Mastering & Automation Timeline */}
                    <div className="bg-black/40 border border-emerald-900/30 rounded-lg p-6 space-y-4">
                      <div className="flex justify-between items-center">
                        <h3 className="text-[10px] font-bold text-emerald-500 flex items-center gap-2">
                          <Activity className="w-3 h-3" />
                          AI_MASTERING_ASSISTANT
                        </h3>
                        <button 
                          onClick={runAiMastering}
                          className="px-4 py-2 bg-emerald-500 text-black rounded font-black text-[10px] tracking-widest hover:bg-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-all"
                        >
                          RUN MASTERING
                        </button>
                      </div>
                    </div>

                    <div className="bg-black/40 border border-emerald-900/30 rounded-lg p-6 space-y-4">
                      <div className="flex justify-between items-center">
                        <h3 className="text-[10px] font-bold text-emerald-500 flex items-center gap-2">
                          <Clock className="w-3 h-3" />
                          AUTOMATION_LANE
                        </h3>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => {
                            if (!isRecording) {
                              setAutomation([]);
                              automationStartTimeRef.current = Date.now();
                            }
                            setIsRecording(!isRecording);
                          }}
                          className={`p-2 rounded border transition-all ${isRecording ? 'bg-red-500 text-white border-red-400 animate-pulse' : 'bg-white/5 border-white/10 text-white/40 hover:text-white'}`}
                        >
                          <Circle className="w-3 h-3 fill-current" />
                        </button>
                        <button 
                          onClick={() => setIsPlayback(!isPlayback)}
                          className={`p-2 rounded border transition-all ${isPlayback ? 'bg-emerald-500 text-black border-emerald-400' : 'bg-white/5 border-white/10 text-white/40 hover:text-white'}`}
                        >
                          {isPlayback ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                        </button>
                        <button 
                          onClick={() => setAutomation([])}
                          className="p-2 rounded border bg-white/5 border-white/10 text-white/40 hover:text-red-500"
                        >
                          <Power className="w-3 h-3 rotate-45" />
                        </button>
                        <button 
                          onClick={createClipFromAutomation}
                          disabled={automation.length === 0}
                          className="p-2 rounded border bg-emerald-500/10 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500 hover:text-black disabled:opacity-30 transition-all"
                        >
                          <Save className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    
                    <div className="relative h-24 bg-emerald-950/20 rounded border border-emerald-900/20 overflow-hidden">
                      {/* Playhead */}
                      {isPlayback && (
                        <motion.div 
                          style={{ left: `${(timelinePos / 10000) * 100}%` }}
                          className="absolute top-0 bottom-0 w-px bg-white z-10"
                        />
                      )}
                      
                      {/* Visualization of events */}
                      <svg className="absolute inset-0 w-full h-full opacity-30">
                        {automation.map((e, i) => (
                          <circle 
                            key={i} 
                            cx={`${(e.time / 10000) * 100}%`} 
                            cy={`${100 - (e.value / (e.param === 'cutoff' ? 8000 : 1000)) * 100}%`} 
                            r="1" 
                            fill={e.param === 'freq' ? '#10b981' : '#3b82f6'} 
                          />
                        ))}
                      </svg>
                      
                      {automation.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center text-[8px] text-emerald-900 uppercase tracking-[0.5em]">
                          No Automation Data
                        </div>
                      )}
                    </div>
                  </div>

                  <button 
                    onClick={toggleAudio}
                    className={`w-full py-6 rounded-xl border-2 font-bold text-lg tracking-[0.2em] transition-all flex items-center justify-center gap-4 ${
                      isPlaying 
                      ? 'bg-emerald-500 border-emerald-400 text-black shadow-[0_0_30px_rgba(16,185,129,0.4)]' 
                      : 'bg-emerald-900/20 border-emerald-500/50 text-emerald-500 hover:bg-emerald-800/40'
                    }`}
                  >
                    <Power className="w-6 h-6" />
                    {isPlaying ? '[ HALT SIGNAL ]' : '[ INITIATE SIGNAL ]'}
                  </button>
                </div>

                {/* Right Column: Presets & Loot */}
                <div className="space-y-6 overflow-y-auto pr-4 custom-scrollbar">
                  <div className="bg-emerald-900/10 border border-emerald-800/50 p-5 rounded-lg">
                    <div className="flex justify-between items-center mb-4">
                      <h2 className="text-sm font-bold text-emerald-400 flex items-center gap-2">
                        <FolderOpen className="w-4 h-4" />
                        PRESETS
                      </h2>
                      <button onClick={savePreset} className="p-2 hover:bg-emerald-500/20 rounded-full text-emerald-500 transition-colors">
                        <Save className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {presets.map((p, i) => (
                        <div key={i} className="group relative">
                          <button
                            onClick={() => loadPreset(p)}
                            className="w-full text-left p-3 rounded border border-emerald-800/30 hover:border-emerald-500/50 hover:bg-emerald-500/5 text-[10px] text-emerald-600 hover:text-emerald-400 transition-all uppercase tracking-wider pr-10"
                          >
                            <span className="opacity-50 mr-2">[{p.oscType.slice(0, 3)}]</span>
                            {p.name}
                          </button>
                          {!INITIAL_PRESETS.find(ip => ip.name === p.name) && (
                            <button 
                              onClick={() => deletePreset(p.name)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-red-900 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Power className="w-3 h-3 rotate-45" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-emerald-900/10 border border-emerald-800/50 p-5 rounded-lg">
                    <div className="flex justify-between items-center mb-4">
                      <h2 className="text-sm font-bold text-emerald-400 flex items-center gap-2">
                        <Keyboard className="w-4 h-4" />
                        MIDI_MAPPINGS
                      </h2>
                      <div className="flex gap-1">
                        {MOD_TARGETS.map(target => (
                          <button
                            key={target}
                            onClick={() => setIsMidiLearning(isMidiLearning === target ? null : target as any)}
                            className={`px-1.5 py-0.5 rounded text-[7px] uppercase transition-all border ${
                              isMidiLearning === target 
                              ? 'bg-emerald-500 text-black border-emerald-400 animate-pulse' 
                              : 'bg-white/5 border-white/10 text-emerald-700 hover:text-emerald-400'
                            }`}
                          >
                            LEARN_{target.slice(0, 3)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      {midiMappings.length > 0 ? (
                        midiMappings.map((m, i) => (
                          <div key={i} className="group flex justify-between items-center text-[10px] p-2 border border-emerald-900/20 rounded bg-black/20 hover:border-emerald-500/30 transition-all">
                            <div className="flex gap-4">
                              <span className="text-emerald-700 uppercase font-mono">CC_{m.cc}</span>
                              <span className="text-emerald-400 uppercase tracking-widest">{m.param}</span>
                            </div>
                            <button 
                              onClick={() => setMidiMappings(prev => prev.filter((_, idx) => idx !== i))}
                              className="text-red-900 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Power className="w-3 h-3 rotate-45" />
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="text-[8px] text-emerald-900 text-center py-4 border border-dashed border-emerald-900/20 rounded uppercase tracking-[0.3em]">
                          No Mappings Defined
                        </div>
                      )}
                      <div className="text-[8px] text-emerald-800 mt-2 italic flex justify-between items-center">
                        <span>* Connect MIDI device to use CC mappings</span>
                        {isMidiLearning && <span className="text-emerald-400 animate-pulse">WAITING FOR MIDI CC...</span>}
                      </div>
                    </div>
                  </div>

                  <div className="bg-emerald-900/10 border border-emerald-800/50 p-5 rounded-lg">
                    <h2 className="text-sm font-bold mb-4 text-emerald-400 flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      AUDIO_CLIPS
                    </h2>
                    <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-2">
                      {clips.map(clip => (
                        <div key={clip.id} className="group relative">
                          <button
                            onClick={() => playClip(clip)}
                            className="w-full text-left p-3 rounded border border-emerald-800/30 hover:border-emerald-500/50 hover:bg-emerald-500/5 text-[10px] text-emerald-600 hover:text-emerald-400 transition-all uppercase tracking-wider pr-10 flex justify-between items-center"
                          >
                            <span>{clip.name}</span>
                            <span className="opacity-30 text-[8px]">{(clip.duration / 1000).toFixed(1)}s</span>
                          </button>
                          <button 
                            onClick={() => setClips(clips.filter(c => c.id !== clip.id))}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-red-900 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Power className="w-3 h-3 rotate-45" />
                          </button>
                        </div>
                      ))}
                      {clips.length === 0 && (
                        <div className="text-[8px] text-emerald-900 text-center py-8 border border-dashed border-emerald-900/20 rounded uppercase tracking-[0.3em]">
                          No Clips Recorded
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-emerald-900/10 border border-emerald-800/50 p-5 rounded-lg">
                    <div className="flex justify-between items-center mb-4">
                      <h2 className="text-sm font-bold text-emerald-400 flex items-center gap-2">
                        <Shield className="w-4 h-4" />
                        IDENTITY_PROFILES
                      </h2>
                      <div className="flex items-center gap-2 text-[8px] font-mono">
                        <span className={isAutoSaving ? "text-emerald-400 animate-pulse" : "text-emerald-800"}>
                          {isAutoSaving ? "SYNCING..." : `LAST_SYNC: ${lastSaved || 'NEVER'}`}
                        </span>
                        <div className={`w-1.5 h-1.5 rounded-full ${isAutoSaving ? 'bg-emerald-400 animate-ping' : 'bg-emerald-900'}`} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      {profiles.map(p => (
                        <button
                          key={p.id}
                          onClick={() => switchProfile(p.id)}
                          className={`w-full text-left p-3 rounded border transition-all flex justify-between items-center ${
                            activeProfileId === p.id 
                            ? 'bg-emerald-500 text-black border-emerald-400 font-bold' 
                            : 'bg-white/5 border-white/10 text-emerald-600 hover:text-emerald-400'
                          }`}
                        >
                          <span className="text-[10px] tracking-widest uppercase">{p.alias}</span>
                          {activeProfileId === p.id && <div className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />}
                        </button>
                      ))}
                      <button
                        onClick={createProfile}
                        className="w-full p-2 rounded border border-dashed border-emerald-500/30 text-emerald-500/50 hover:text-emerald-500 hover:border-emerald-500 transition-all text-[8px] uppercase tracking-[0.3em] mt-2"
                      >
                        + NEW IDENTITY
                      </button>
                    </div>
                  </div>

                  <div className="bg-emerald-900/10 border border-emerald-800/50 p-5 rounded-lg">
                    <h2 className="text-sm font-bold mb-4 text-emerald-400 flex items-center gap-2">
                      <Terminal className="w-4 h-4" />
                      DATA_FRAGMENTS
                    </h2>
                    <div className="space-y-2">
                      {dataFragments.map(frag => (
                        <div key={frag.id} className="space-y-1">
                          <button
                            onClick={() => setActiveFragment(activeFragment === frag.id ? null : frag.id)}
                            className={`w-full text-left p-2 rounded border text-[8px] uppercase tracking-widest transition-all ${activeFragment === frag.id ? 'bg-emerald-500 text-black border-emerald-400' : 'bg-white/5 border-white/10 text-emerald-600 hover:text-emerald-400'}`}
                          >
                            {frag.title}
                          </button>
                          <AnimatePresence>
                            {activeFragment === frag.id && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                              >
                                <div className="p-2 text-[7px] text-emerald-500/60 italic leading-relaxed border-l border-emerald-500/20 ml-2">
                                  {frag.content}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-emerald-900/10 border border-emerald-800/50 p-5 rounded-lg">
                    <h2 className="text-sm font-bold mb-4 text-emerald-400 flex items-center gap-2">
                      <FolderOpen className="w-4 h-4" />
                      TEMPLATES
                    </h2>
                    <div className="grid grid-cols-2 gap-2">
                      {['AMBIENT', 'TECHNO', 'GLITCH', 'CINEMATIC', 'SOUNDSCAPE'].map(t => (
                        <button
                          key={t}
                          onClick={() => loadTemplate(t)}
                          className="p-2 rounded border border-emerald-800/30 hover:border-emerald-500/50 bg-white/5 text-[8px] text-emerald-600 hover:text-emerald-400 transition-all uppercase tracking-widest"
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <AnimatePresence>
                    {missionComplete && (
                      <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-emerald-500/10 border border-emerald-500 p-6 rounded-lg text-center space-y-4"
                      >
                        <p className="text-[10px] text-emerald-400 font-bold tracking-widest uppercase">
                          {`> DECRYPTION SUCCESSFUL. PAYLOAD UNLOCKED.`}
                        </p>
                        <a 
                          href="https://ohmforce.com/downloads/Symptohm_PE_Installer.exe" 
                          download 
                          className="block w-full bg-emerald-500 text-black py-4 rounded-lg text-xs font-black uppercase tracking-widest hover:bg-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.3)]"
                        >
                          EXTRACT VST WEAPON
                        </a>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                </>
              ) : uiMode === 'WELLNESS' ? (
                <div className="col-span-4 flex flex-col items-center justify-center space-y-12 relative overflow-hidden">
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute inset-0 pointer-events-none"
                  >
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-emerald-500/5 rounded-full blur-[120px] animate-pulse" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-purple-500/5 rounded-full blur-[100px] animate-pulse delay-700" />
                  </motion.div>

                  <div className="text-center space-y-4 z-10">
                    <h2 className="text-4xl font-light text-emerald-400/80 tracking-[0.5em] uppercase">Maja_Neuro_Interface</h2>
                    <p className="text-xs text-emerald-700/60 tracking-widest uppercase italic">"Breathe_Into_The_Signal_Bypass_The_Flesh"</p>
                  </div>

                  <motion.button
                    animate={{ 
                      scale: [1, 1.1, 1],
                      boxShadow: [
                        "0 0 20px rgba(16, 185, 129, 0.1)",
                        "0 0 60px rgba(16, 185, 129, 0.3)",
                        "0 0 20px rgba(16, 185, 129, 0.1)"
                      ]
                    }}
                    transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
                    onClick={handleTap}
                    className="relative w-64 h-64 rounded-full border border-emerald-500/20 flex flex-col items-center justify-center group hover:border-emerald-500/50 transition-all bg-black/40 backdrop-blur-xl"
                  >
                    <div className="absolute inset-0 rounded-full border border-emerald-500/10 animate-ping opacity-20" />
                    <span className="text-emerald-400 text-2xl tracking-[0.4em] font-light mb-2">BREATHE</span>
                    <span className="text-[8px] text-emerald-700 uppercase tracking-widest">{freq.toFixed(1)} Hz</span>
                  </motion.button>

                  <div className="grid grid-cols-3 gap-12 w-full max-w-4xl z-10">
                    <div className="space-y-4">
                      <label className="text-[10px] text-emerald-600 uppercase tracking-widest block text-center">Breath_Depth</label>
                      <input 
                        type="range" min="50" max="1000" value={freq} onChange={(e) => setFreq(Number(e.target.value))}
                        className="w-full h-1 bg-emerald-900/40 rounded-lg appearance-none cursor-pointer accent-emerald-500/50"
                      />
                    </div>
                    <div className="space-y-4">
                      <label className="text-[10px] text-emerald-600 uppercase tracking-widest block text-center">Neural_Clarity</label>
                      <input 
                        type="range" min="100" max="8000" value={cutoff} onChange={(e) => setCutoff(Number(e.target.value))}
                        className="w-full h-1 bg-emerald-900/40 rounded-lg appearance-none cursor-pointer accent-emerald-500/50"
                      />
                    </div>
                    <div className="space-y-4">
                      <label className="text-[10px] text-emerald-600 uppercase tracking-widest block text-center">Resonance_Sync</label>
                      <input 
                        type="range" min="0" max="5000" value={fmAmount} onChange={(e) => setFmAmount(Number(e.target.value))}
                        className="w-full h-1 bg-emerald-900/40 rounded-lg appearance-none cursor-pointer accent-emerald-500/50"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="col-span-4 grid grid-cols-3 gap-8 flex-1 overflow-hidden">
                  <div className="col-span-2 flex flex-col space-y-6 overflow-y-auto pr-4 custom-scrollbar">
                    <div className="bg-black/40 border border-emerald-500/30 p-8 rounded-xl space-y-6">
                      <div className="flex justify-between items-center border-b border-emerald-500/20 pb-4">
                        <h2 className="text-xl font-bold text-emerald-400 tracking-tighter uppercase">{`> SYSTEM_LOG_ANALYSIS`}</h2>
                        <span className="text-[10px] text-emerald-700">NODE_ID: {activeProfileId.toUpperCase()}</span>
                      </div>
                      <div className="space-y-4 font-mono text-xs leading-relaxed">
                        {dataFragments.slice(0, 8).map(frag => (
                          <div key={frag.id} className="p-4 border border-emerald-900/30 rounded bg-emerald-900/5 hover:bg-emerald-900/10 transition-all cursor-pointer group">
                            <div className="flex justify-between mb-2">
                              <span className="text-emerald-500 font-bold">{frag.title}</span>
                              <span className="text-emerald-800 text-[8px] opacity-0 group-hover:opacity-100 transition-opacity">DECRYPTED</span>
                            </div>
                            <p className="text-emerald-700/80">{frag.content}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-6 overflow-y-auto pr-4 custom-scrollbar">
                    <div className="bg-emerald-900/10 border border-emerald-800/50 p-6 rounded-xl space-y-6">
                      <h2 className="text-sm font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                        <Activity className="w-4 h-4" />
                        COMBAT_METRICS
                      </h2>
                      <div className="space-y-4">
                        <div className="flex justify-between items-end">
                          <span className="text-[10px] text-emerald-700 uppercase">Neural_Load</span>
                          <span className="text-lg font-bold text-emerald-400">{cpuUsage}%</span>
                        </div>
                        <div className="w-full h-1 bg-emerald-900/40 rounded-full overflow-hidden">
                          <motion.div animate={{ width: `${cpuUsage}%` }} className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                        </div>
                        <div className="flex justify-between items-end pt-4">
                          <span className="text-[10px] text-emerald-700 uppercase">Signal_Purity</span>
                          <span className="text-lg font-bold text-emerald-400">{(cutoff / 80).toFixed(1)}%</span>
                        </div>
                        <div className="w-full h-1 bg-emerald-900/40 rounded-full overflow-hidden">
                          <motion.div animate={{ width: `${(cutoff / 8000) * 100}%` }} className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                        </div>
                      </div>
                    </div>

                    <div className="bg-emerald-900/10 border border-emerald-800/50 p-6 rounded-xl space-y-4">
                      <h2 className="text-sm font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                        <Shield className="w-4 h-4" />
                        ACTIVE_DEFENSES
                      </h2>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-3 border border-emerald-900/30 rounded bg-black/20 text-center">
                          <p className="text-[8px] text-emerald-700 uppercase mb-1">Firewall</p>
                          <p className="text-xs text-emerald-400 font-bold">ACTIVE</p>
                        </div>
                        <div className="p-3 border border-emerald-900/30 rounded bg-black/20 text-center">
                          <p className="text-[8px] text-emerald-700 uppercase mb-1">Ghost_Node</p>
                          <p className="text-xs text-emerald-400 font-bold">ENABLED</p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-emerald-900/10 border border-emerald-800/50 p-6 rounded-xl space-y-4">
                      <div className="flex justify-between items-center">
                        <h2 className="text-sm font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                          <FolderOpen className="w-4 h-4" />
                          PRESET_DATABASE
                        </h2>
                        <button 
                          onClick={savePreset}
                          className="p-1 hover:bg-emerald-500/20 rounded border border-emerald-500/30 text-emerald-500 transition-all"
                        >
                          <Save className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-2 max-h-[200px] overflow-y-auto custom-scrollbar pr-2">
                        {presets.map((p, i) => (
                          <div key={i} className="group relative flex items-center">
                            <button
                              onClick={() => loadPreset(p)}
                              className="flex-1 text-left p-2 rounded border border-emerald-900/30 hover:border-emerald-500/50 hover:bg-emerald-500/5 text-[9px] text-emerald-600 hover:text-emerald-400 transition-all uppercase tracking-wider"
                            >
                              <span className="opacity-50 mr-2">[{p.oscType.slice(0, 3)}]</span>
                              {p.name}
                            </button>
                            {!INITIAL_PRESETS.find(ip => ip.name === p.name) && (
                              <button 
                                onClick={() => deletePreset(p.name)}
                                className="ml-2 p-1 text-red-900 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Power className="w-3 h-3 rotate-45" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

              <footer className="mt-8 pt-4 border-t border-emerald-900/30 flex justify-between items-center text-[8px] text-emerald-800 tracking-[0.3em] uppercase">
                <span>Amadeus Focus Terminal // Node_ID: {Math.random().toString(36).substr(2, 9)}</span>
                <span className="flex items-center gap-4">
                  <Activity className="w-3 h-3 animate-pulse" />
                  System Nominal
                </span>
              </footer>
            </motion.div>
          )
        }
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.1);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(16, 185, 129, 0.2);
          border-radius: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(16, 185, 129, 0.4);
        }
      `}</style>
    </div>
  );
}
