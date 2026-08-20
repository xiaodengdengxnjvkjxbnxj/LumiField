import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MeshGradient } from '@paper-design/shaders-react';
import { motion, useReducedMotion } from 'framer-motion';

const SOURCE_COLORS = Object.freeze([
  '#FFB3D9',
  '#87CEEB',
  '#4A90E2',
  '#2C3E50',
  '#1A1A2E'
]);

const SOURCE_PATH = 'M230.809 115.385V249.411C230.809 269.923 214.985 287.282 194.495 288.411C184.544 288.949 175.364 285.718 168.26 280C159.746 273.154 147.769 273.461 139.178 280.23C132.638 285.384 124.381 288.462 115.379 288.462C106.377 288.462 98.1451 285.384 91.6055 280.23C82.912 273.385 70.9353 273.385 62.2415 280.23C55.7532 285.334 47.598 288.411 38.7246 288.462C17.4132 288.615 0 270.667 0 249.359V115.385C0 51.6667 51.6756 0 115.404 0C179.134 0 230.809 51.6667 230.809 115.385Z';

const roots = new WeakMap();
const runtime = {
  mounts: 0,
  unmounts: 0,
  listenerCount: 0,
  pointerFrames: 0,
  eyeX: 0,
  eyeY: 0,
  trackingRadiusX: 0,
  trackingRadiusY: 0,
  hovered: false,
  greeting: '',
  paused: false
};

function localGreeting() {
  const hour = new Date().getHours();
  if (hour < 11) return '早上好';
  if (hour < 18) return '中午好';
  return '晚上好';
}

function MeshGradientSVG({ paused = false }) {
  const svgRef = useRef(null);
  const pointerRafRef = useRef(0);
  const latestPointerRef = useRef({ x: 0, y: 0 });
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(false);
  const [greeting, setGreeting] = useState('');
  const reducedMotion = useReducedMotion();
  const motionPaused = paused || reducedMotion;

  useEffect(() => {
    runtime.mounts += 1;
    runtime.listenerCount += 2;
    const handleMouseMove = (event) => {
      latestPointerRef.current = { x: event.clientX, y: event.clientY };
      if (pointerRafRef.current) return;
      pointerRafRef.current = requestAnimationFrame(() => {
        pointerRafRef.current = 0;
        runtime.pointerFrames += 1;
        setMousePosition(latestPointerRef.current);
      });
    };
    const handleWindowMouseOut = (event) => {
      if (event.relatedTarget || event.toElement) return;
      latestPointerRef.current = { x: -100000, y: -100000 };
      if (pointerRafRef.current) cancelAnimationFrame(pointerRafRef.current);
      pointerRafRef.current = 0;
      runtime.hovered = false;
      runtime.greeting = '';
      setMousePosition(latestPointerRef.current);
    };
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mouseout', handleWindowMouseOut, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseout', handleWindowMouseOut);
      if (pointerRafRef.current) cancelAnimationFrame(pointerRafRef.current);
      pointerRafRef.current = 0;
      runtime.listenerCount = Math.max(0, runtime.listenerCount - 2);
      runtime.unmounts += 1;
      runtime.eyeX = 0;
      runtime.eyeY = 0;
      runtime.hovered = false;
      runtime.greeting = '';
    };
  }, []);

  useEffect(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const deltaX = mousePosition.x - centerX;
    const deltaY = mousePosition.y - centerY;
    const maxOffset = 8;
    const radiusX = Math.max(220, window.innerWidth * 0.32);
    const radiusY = Math.max(160, window.innerHeight * 0.32);
    const next = {
      x: Math.max(-maxOffset, Math.min(maxOffset, maxOffset * Math.tanh(deltaX / radiusX))),
      y: Math.max(-maxOffset, Math.min(maxOffset, maxOffset * Math.tanh(deltaY / radiusY)))
    };
    const nextHovered = mousePosition.x >= rect.left && mousePosition.x <= rect.right && mousePosition.y >= rect.top && mousePosition.y <= rect.bottom;
    const nextGreeting = nextHovered ? localGreeting() : '';
    runtime.eyeX = next.x;
    runtime.eyeY = next.y;
    runtime.trackingRadiusX = radiusX;
    runtime.trackingRadiusY = radiusY;
    runtime.hovered = nextHovered;
    runtime.greeting = nextGreeting;
    setEyeOffset(next);
    setHovered(nextHovered);
    setGreeting(nextGreeting);
  }, [mousePosition]);

  useEffect(() => {
    runtime.paused = motionPaused;
  }, [motionPaused]);

  return (
    <motion.div
      className="lf-home-pet-source-motion"
      animate={motionPaused ? { y: 0, scaleY: 1 } : { y: [0, -8, 0], scaleY: [1, 1.08, 1] }}
      transition={motionPaused ? { duration: 0 } : { duration: 2.8, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
      style={{ transformOrigin: 'top center' }}
    >
      <svg
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        width="231"
        height="289"
        viewBox="0 0 231 289"
        className="lf-home-pet-source-svg"
        focusable="false"
        aria-hidden="true"
      >
        <defs>
          <clipPath id="lf-home-pet-source-shape-clip">
            <path d={SOURCE_PATH} />
          </clipPath>
        </defs>
        <foreignObject width="231" height="289" clipPath="url(#lf-home-pet-source-shape-clip)">
          <div className="lf-home-pet-source-gradient">
            <MeshGradient colors={SOURCE_COLORS} className="lf-home-pet-source-mesh" speed={motionPaused ? 0 : 1} />
          </div>
        </foreignObject>
        <motion.ellipse
          className="lf-home-pet-source-eye lf-home-pet-source-blink"
          cx={80}
          cy={120}
          rx="20"
          ry="30"
          fill="currentColor"
          initial={{ cx: 80, cy: 120 }}
          animate={{ cx: 80 + eyeOffset.x, cy: 120 + eyeOffset.y }}
          transition={{ type: 'spring', stiffness: 150, damping: 15 }}
        />
        <motion.ellipse
          className="lf-home-pet-source-eye lf-home-pet-source-blink"
          cx={150}
          cy={120}
          rx="20"
          ry="30"
          fill="currentColor"
          initial={{ cx: 150, cy: 120 }}
          animate={{ cx: 150 + eyeOffset.x, cy: 120 + eyeOffset.y }}
          transition={{ type: 'spring', stiffness: 150, damping: 15 }}
        />
      </svg>
      <div className="lf-home-pet-greeting" data-visible={hovered ? 'true' : 'false'} aria-hidden="true">
        {greeting}
      </div>
    </motion.div>
  );
}

export function mount(host, options = {}) {
  if (!host || roots.has(host)) return false;
  const root = createRoot(host);
  roots.set(host, { root, paused: options.paused === true });
  root.render(<MeshGradientSVG paused={options.paused === true} />);
  return true;
}

export function setPaused(host, paused) {
  const record = host ? roots.get(host) : null;
  if (!record) return false;
  const next = paused === true;
  if (record.paused === next) return true;
  record.paused = next;
  record.root.render(<MeshGradientSVG paused={next} />);
  return true;
}

export function unmount(host) {
  const record = host ? roots.get(host) : null;
  if (!record) return false;
  record.root.unmount();
  roots.delete(host);
  return true;
}

export function getDebug(host) {
  const mounted = !!(host && roots.has(host));
  return {
    sourceId: '21st-reuno-ui-shader-svg-revision-92',
    componentVersion: '5d5a63b6-add4-4793-84e2-8cd5d27eb067',
    colors: SOURCE_COLORS.slice(),
    path: SOURCE_PATH,
    speed: runtime.paused ? 0 : 1,
    eyeLimit: 8,
    eyeX: runtime.eyeX,
    eyeY: runtime.eyeY,
    trackingRadiusX: runtime.trackingRadiusX,
    trackingRadiusY: runtime.trackingRadiusY,
    mapping: 'viewport-tanh',
    hovered: runtime.hovered,
    greeting: runtime.greeting,
    pointerFrames: runtime.pointerFrames,
    listenerCount: runtime.listenerCount,
    mounts: runtime.mounts,
    unmounts: runtime.unmounts,
    paused: runtime.paused,
    mounted
  };
}
