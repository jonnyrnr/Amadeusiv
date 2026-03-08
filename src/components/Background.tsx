import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface BackgroundProps {
  isPlaying: boolean;
  missionComplete: boolean;
  freq: number;
  cutoff: number;
  fmAmount: number;
  oscType: string;
  audioData: Uint8Array;
}

export const Background: React.FC<BackgroundProps> = ({ isPlaying, missionComplete, freq, cutoff, fmAmount, oscType, audioData }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const particlesRef = useRef<THREE.Points | null>(null);
  const materialRef = useRef<THREE.PointsMaterial | null>(null);
  const rotationSpeedRef = useRef(0.002);

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 30;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const geometry = new THREE.BufferGeometry();
    const particleCount = 2000;
    const posArray = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i++) {
      posArray[i] = (Math.random() - 0.5) * 60;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));

    const material = new THREE.PointsMaterial({
      size: 0.1,
      color: 0x10b981,
      transparent: true,
      opacity: 0.8,
    });
    materialRef.current = material;

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);
    particlesRef.current = particles;

    let time = 0;
    const animate = () => {
      requestAnimationFrame(animate);
      time += 0.01;
      
      if (particles && material) {
        particles.rotation.y += rotationSpeedRef.current;
        particles.rotation.x += rotationSpeedRef.current * 0.5;

        if (isPlaying) {
          // Real-time audio data influence
          const avgFreq = audioData.length > 0 ? audioData.reduce((a, b) => a + b) / audioData.length : 0;
          const audioIntensity = avgFreq / 255;

          // Dynamic scaling based on cutoff, time and real audio data
          const pulseIntensity = (cutoff / 8000) * 0.2;
          const fmJitter = (fmAmount / 5000) * 0.1;
          
          // Waveform specific behavior
          let waveScale = 1;
          if (oscType === 'square') waveScale = Math.sin(time * 20) > 0 ? 1.1 : 0.9;
          if (oscType === 'sawtooth') waveScale = 1 + (time % 0.1) * 2;
          if (oscType === 'wavetable') waveScale = 1 + Math.random() * 0.2;
          if (oscType === 'string') waveScale = 1 + (audioIntensity * 0.5);
          if (oscType === 'granular') waveScale = 1 + (Math.sin(time * 50) * 0.1);

          const scale = (1 + Math.sin(time * 10) * pulseIntensity + (Math.random() * fmJitter) + (audioIntensity * 0.3)) * waveScale;
          particles.scale.set(scale, scale, scale);

          // Dynamic color based on frequency, FM and audio intensity
          const hue = (0.3 + (freq / 1000) * 0.3 + (audioIntensity * 0.2) + (fmAmount / 5000) * 0.1) % 1;
          const saturation = 0.5 + (fmAmount / 5000) * 0.5;
          material.color.setHSL(hue, saturation, 0.5);
          
          // Opacity and size based on audio data
          material.opacity = 0.3 + (cutoff / 8000) * 0.4 + (audioIntensity * 0.3);
          material.size = 0.05 + (cutoff / 8000) * 0.1 + (fmAmount / 5000) * 0.1 + (audioIntensity * 0.2);

          // Jitter particles based on audio and FM
          if (audioIntensity > 0.5 || fmAmount > 2000) {
            const positions = geometry.attributes.position.array as Float32Array;
            const jitterAmount = audioIntensity + (fmAmount / 5000) * 0.5;
            for (let i = 0; i < 150; i++) {
              const idx = Math.floor(Math.random() * particleCount) * 3;
              positions[idx] += (Math.random() - 0.5) * jitterAmount;
              positions[idx+1] += (Math.random() - 0.5) * jitterAmount;
              positions[idx+2] += (Math.random() - 0.5) * jitterAmount;
            }
            geometry.attributes.position.needsUpdate = true;
          }
        } else {
          particles.scale.set(1, 1, 1);
          material.color.setHex(0x10b981);
          material.opacity = 0.8;
          material.size = 0.1;
        }

        if (missionComplete) {
          // Rainbow effect when mission is complete
          material.color.setHSL((time * 0.2) % 1, 0.8, 0.5);
          material.size = 0.15;
        }
      }
      
      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      if (containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    if (missionComplete) {
      rotationSpeedRef.current = 0.015;
    } else {
      rotationSpeedRef.current = 0.002;
    }
  }, [missionComplete]);

  return <div ref={containerRef} className="fixed inset-0 pointer-events-none z-0" />;
};
