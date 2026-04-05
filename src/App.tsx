/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { io, Socket } from 'socket.io-client';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<PointerLockControls | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [showStart, setShowStart] = useState(true);
  const [playerCount, setPlayerCount] = useState(1);

  useEffect(() => {
    if (!containerRef.current) return;

    // --- Scene Setup ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2a2a05);
    scene.fog = new THREE.FogExp2(0xaaaa44, 0.04);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 1000);
    
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    containerRef.current.appendChild(renderer.domElement);

    // --- Detailed Voxel Hazmat Player Model Factory ---
    const createHazmatModel = () => {
      const group = new THREE.Group();
      
      const suitColor = 0xffeb3b;
      const suitMaterial = new THREE.MeshStandardMaterial({ color: suitColor, roughness: 0.8 });
      const maskMaterial = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, metalness: 0.8 });
      const bootMaterial = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
      const packMaterial = new THREE.MeshStandardMaterial({ color: 0xddcc44, roughness: 0.7 });

      // Helper to add a blocky part
      const addVoxelPart = (parent: THREE.Group | THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, name?: string) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (name) mesh.name = name;
        parent.add(mesh);
        return mesh;
      };

      // Torso (Main Body) - Built from multiple blocks for detail
      const torsoGroup = new THREE.Group();
      torsoGroup.position.y = 0.9;
      group.add(torsoGroup);
      
      // Main torso block
      addVoxelPart(torsoGroup, 0.45, 0.6, 0.25, 0, 0, 0, suitMaterial);
      // Chest detail
      addVoxelPart(torsoGroup, 0.3, 0.2, 0.05, 0, 0.1, 0.13, packMaterial);
      // Belt
      addVoxelPart(torsoGroup, 0.48, 0.08, 0.28, 0, -0.2, 0, bootMaterial);

      // Backpack (Oxygen Tank)
      const packGroup = new THREE.Group();
      packGroup.position.set(0, 0.1, -0.2);
      torsoGroup.add(packGroup);
      addVoxelPart(packGroup, 0.3, 0.45, 0.15, 0, 0, 0, packMaterial);
      addVoxelPart(packGroup, 0.1, 0.1, 0.05, 0.08, 0.2, 0.08, bootMaterial); // Valve

      // Head (Helmet)
      const headGroup = new THREE.Group();
      headGroup.position.y = 1.4;
      group.add(headGroup);
      
      // Helmet base
      addVoxelPart(headGroup, 0.35, 0.35, 0.35, 0, 0, 0, suitMaterial);
      // Visor (The glass)
      addVoxelPart(headGroup, 0.28, 0.18, 0.05, 0, 0.05, 0.16, maskMaterial);
      // Breathing apparatus
      addVoxelPart(headGroup, 0.15, 0.1, 0.1, 0, -0.12, 0.15, bootMaterial);

      // Arms (Detailed with segments)
      const createArm = (side: number) => {
        const armGroup = new THREE.Group();
        armGroup.position.set(side * 0.3, 1.15, 0);
        
        // Upper arm
        const upper = addVoxelPart(armGroup, 0.12, 0.25, 0.12, 0, -0.1, 0, suitMaterial);
        // Lower arm
        const lower = addVoxelPart(upper, 0.1, 0.25, 0.1, 0, -0.25, 0, suitMaterial);
        // Hand
        addVoxelPart(lower, 0.12, 0.08, 0.12, 0, -0.15, 0, bootMaterial);
        
        return armGroup;
      };

      const leftArm = createArm(-1);
      leftArm.name = "leftArm";
      group.add(leftArm);

      const rightArm = createArm(1);
      rightArm.name = "rightArm";
      group.add(rightArm);

      // Legs (Detailed with segments)
      const createLeg = (side: number) => {
        const legGroup = new THREE.Group();
        legGroup.position.set(side * 0.15, 0.6, 0);
        
        // Upper leg
        const upper = addVoxelPart(legGroup, 0.15, 0.3, 0.15, 0, -0.15, 0, suitMaterial);
        // Lower leg
        const lower = addVoxelPart(upper, 0.13, 0.3, 0.13, 0, -0.3, 0, suitMaterial);
        // Boot
        const boot = addVoxelPart(lower, 0.16, 0.12, 0.25, 0, -0.18, 0.05, bootMaterial);
        
        return legGroup;
      };

      const leftLeg = createLeg(-1);
      leftLeg.name = "leftLeg";
      group.add(leftLeg);

      const rightLeg = createLeg(1);
      rightLeg.name = "rightLeg";
      group.add(rightLeg);

      return group;
    };

    // --- Multiplayer Setup ---
    const otherPlayers: Record<string, { model: THREE.Group, lastPos: THREE.Vector3 }> = {};
    socketRef.current = io();

    socketRef.current.on('currentPlayers', (players: Record<string, any>) => {
      Object.keys(players).forEach((id) => {
        if (id !== socketRef.current?.id) {
          const model = createHazmatModel();
          model.position.set(players[id].x, players[id].y, players[id].z);
          scene.add(model);
          otherPlayers[id] = { model, lastPos: model.position.clone() };
        }
      });
      setPlayerCount(Object.keys(players).length);
    });

    socketRef.current.on('playerMoved', (data: any) => {
      if (otherPlayers[data.id]) {
        otherPlayers[data.id].model.position.set(data.x, data.y, data.z);
        otherPlayers[data.id].model.rotation.y = data.ry;
      } else {
        const model = createHazmatModel();
        model.position.set(data.x, data.y, data.z);
        scene.add(model);
        otherPlayers[data.id] = { model, lastPos: model.position.clone() };
      }
    });

    socketRef.current.on('playerDisconnected', (id: string) => {
      if (otherPlayers[id]) {
        scene.remove(otherPlayers[id].model);
        delete otherPlayers[id];
      }
      setPlayerCount((prev) => Math.max(1, prev - 1));
    });

    // --- Controls ---
    const controls = new PointerLockControls(camera, document.body);
    controlsRef.current = controls;
    
    const onLock = () => {
      setIsLocked(true);
      setShowStart(false);
    };
    const onUnlock = () => {
      setIsLocked(false);
    };

    controls.addEventListener('lock', onLock);
    controls.addEventListener('unlock', onUnlock);

    // --- Procedural Textures (Enhanced) ---
    const createWallpaperTexture = () => {
      const size = 1024;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      
      ctx.fillStyle = '#ffeb3b';
      ctx.fillRect(0, 0, size, size);
      
      ctx.strokeStyle = '#fbc02d';
      ctx.lineWidth = 4;
      for (let i = 0; i < size; i += 40) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, size);
        ctx.stroke();
      }

      ctx.fillStyle = '#9c8d4a';
      ctx.globalAlpha = 0.2;
      for (let x = 0; x < size; x += 80) {
        for (let y = 0; y < size; y += 80) {
          ctx.beginPath();
          ctx.moveTo(x + 40, y + 10);
          ctx.lineTo(x + 70, y + 40);
          ctx.lineTo(x + 40, y + 70);
          ctx.lineTo(x + 10, y + 40);
          ctx.closePath();
          ctx.fill();
        }
      }

      ctx.globalAlpha = 0.15;
      for (let i = 0; i < 15; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const r = Math.random() * 100 + 50;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, '#5c4b2a');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      return texture;
    };

    const createFloorTexture = () => {
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      
      // Extremely vibrant Backrooms yellow carpet color
      ctx.fillStyle = '#fdd835';
      ctx.fillRect(0, 0, size, size);
      
      for (let i = 0; i < 50000; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const c = Math.random() * 30;
        ctx.fillStyle = `rgb(${220+c}, ${200+c}, ${50+c})`;
        ctx.fillRect(x, y, 1, 1);
      }

      ctx.globalAlpha = 0.2;
      for (let i = 0; i < 25; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const r = Math.random() * 100 + 30;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, '#5c4b2a');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      return texture;
    };

    const wallTex = createWallpaperTexture();
    const floorTex = createFloorTexture();

    const wallMaterial = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.6 });
    const floorMaterial = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.7 });
    const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0xffeb3b, roughness: 0.5 });

    // --- Maze Generation (More Complex) ---
    const mazeSize = 80;
    const cellSize = 4;
    const maze: number[][] = [];

    // Initialize with walls
    for (let i = 0; i < mazeSize; i++) {
      maze[i] = [];
      for (let j = 0; j < mazeSize; j++) {
        maze[i][j] = 1;
      }
    }

    // Simple Room-based Maze Generation
    const rooms: {x: number, z: number, w: number, h: number}[] = [];
    for (let i = 0; i < 40; i++) {
      const w = Math.floor(Math.random() * 6) + 3;
      const h = Math.floor(Math.random() * 6) + 3;
      const x = Math.floor(Math.random() * (mazeSize - w - 2)) + 1;
      const z = Math.floor(Math.random() * (mazeSize - h - 2)) + 1;
      
      let overlap = false;
      for (const r of rooms) {
        if (x < r.x + r.w + 1 && x + w + 1 > r.x && z < r.z + r.h + 1 && z + h + 1 > r.z) {
          overlap = true;
          break;
        }
      }

      if (!overlap) {
        for (let rx = x; rx < x + w; rx++) {
          for (let rz = z; rz < z + h; rz++) {
            maze[rx][rz] = 0;
          }
        }
        rooms.push({x, z, w, h});
      }
    }

    // Connect rooms with corridors
    for (let i = 0; i < rooms.length - 1; i++) {
      const r1 = rooms[i];
      const r2 = rooms[i+1];
      let currX = Math.floor(r1.x + r1.w / 2);
      let currZ = Math.floor(r1.z + r1.h / 2);
      const targetX = Math.floor(r2.x + r2.w / 2);
      const targetZ = Math.floor(r2.z + r2.h / 2);

      while (currX !== targetX) {
        maze[currX][currZ] = 0;
        currX += currX < targetX ? 1 : -1;
      }
      while (currZ !== targetZ) {
        maze[currX][currZ] = 0;
        currZ += currZ < targetZ ? 1 : -1;
      }
    }

    // Add some random noise for "complexity"
    for (let i = 1; i < mazeSize - 1; i++) {
      for (let j = 1; j < mazeSize - 1; j++) {
        if (maze[i][j] === 0 && Math.random() > 0.95) {
          maze[i][j] = 1; // Random pillars
        }
      }
    }

    const startRoom = rooms[0] || {x: 40, z: 40, w: 2, h: 2};
    const startX = Math.floor(startRoom.x + startRoom.w / 2);
    const startZ = Math.floor(startRoom.z + startRoom.h / 2);
    camera.position.set(startX * cellSize, 1.6, startZ * cellSize);

    const wallGeometry = new THREE.BoxGeometry(cellSize, 4, cellSize);
    for (let i = 0; i < mazeSize; i++) {
      for (let j = 0; j < mazeSize; j++) {
        if (maze[i][j] === 1) {
          const wall = new THREE.Mesh(wallGeometry, wallMaterial);
          wall.position.set(i * cellSize, 2, j * cellSize);
          wall.receiveShadow = true;
          wall.castShadow = true;
          scene.add(wall);
        } else if (Math.random() > 0.99) {
          // Add random "props" (crates/pillars)
          const prop = new THREE.Mesh(
            new THREE.BoxGeometry(1, Math.random() * 2 + 1, 1),
            new THREE.MeshStandardMaterial({ color: 0x887733, roughness: 0.9 })
          );
          prop.position.set(i * cellSize + (Math.random() - 0.5) * 2, 1, j * cellSize + (Math.random() - 0.5) * 2);
          prop.castShadow = true;
          prop.receiveShadow = true;
          scene.add(prop);
        }
      }
    }

    const floorGeometry = new THREE.PlaneGeometry(mazeSize * cellSize, mazeSize * cellSize);
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((mazeSize * cellSize) / 2 - cellSize/2, 0, (mazeSize * cellSize) / 2 - cellSize/2);
    floor.receiveShadow = true;
    scene.add(floor);

    const ceiling = new THREE.Mesh(floorGeometry, ceilingMaterial);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set((mazeSize * cellSize) / 2 - cellSize/2, 4, (mazeSize * cellSize) / 2 - cellSize/2);
    ceiling.receiveShadow = true;
    scene.add(ceiling);

    // --- Lighting (Flickering) ---
    scene.add(new THREE.AmbientLight(0xfff176, 1.2));
    const lights: { light: THREE.PointLight, fixture: THREE.Mesh, baseIntensity: number }[] = [];

    for (let i = 0; i < mazeSize; i += 5) {
      for (let j = 0; j < mazeSize; j += 5) {
        if (maze[i][j] === 0) {
          const intensity = 1.5 + Math.random() * 0.5;
          const light = new THREE.PointLight(0xffeb3b, intensity, 20);
          light.position.set(i * cellSize, 3.8, j * cellSize);
          // CRITICAL: Disable shadows for overhead lights to avoid exceeding MAX_TEXTURE_IMAGE_UNITS
          light.castShadow = false; 
          scene.add(light);

          const fixture = new THREE.Mesh(
            new THREE.BoxGeometry(1.5, 0.1, 0.8),
            new THREE.MeshBasicMaterial({ color: 0xfff176 })
          );
          fixture.position.set(i * cellSize, 3.95, j * cellSize);
          scene.add(fixture);
          
          lights.push({ light, fixture, baseIntensity: intensity });
        }
      }
    }

    // --- Movement & Collision ---
    const velocity = new THREE.Vector3();
    const direction = new THREE.Vector3();
    const moveState = { forward: false, backward: false, left: false, right: false, shift: false };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') moveState.forward = true;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') moveState.backward = true;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') moveState.left = true;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') moveState.right = true;
      if (e.shiftKey) moveState.shift = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') moveState.forward = false;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') moveState.backward = false;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') moveState.left = false;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') moveState.right = false;
      if (!e.shiftKey) moveState.shift = false;
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    const checkCollision = (newPos: THREE.Vector3) => {
      const radius = 0.4; // Player collision radius
      const points = [
        { x: newPos.x + radius, z: newPos.z + radius },
        { x: newPos.x + radius, z: newPos.z - radius },
        { x: newPos.x - radius, z: newPos.z + radius },
        { x: newPos.x - radius, z: newPos.z - radius },
        { x: newPos.x, z: newPos.z }
      ];
      
      for (const p of points) {
        const gridX = Math.round(p.x / cellSize);
        const gridZ = Math.round(p.z / cellSize);
        if (gridX < 0 || gridX >= mazeSize || gridZ < 0 || gridZ >= mazeSize) return true;
        if (maze[gridX][gridZ] === 1) return true;
      }
      return false;
    };

    let prevTime = performance.now();
    let lastEmitTime = 0;

    const animate = () => {
      requestAnimationFrame(animate);
      const time = performance.now();
      
      // Light flickering
      lights.forEach(l => {
        if (Math.random() > 0.98) {
          l.light.intensity = Math.random() > 0.5 ? 0 : l.baseIntensity * 1.5;
          (l.fixture.material as THREE.MeshBasicMaterial).color.set(l.light.intensity > 0 ? 0xfff176 : 0x555500);
        } else {
          l.light.intensity = THREE.MathUtils.lerp(l.light.intensity, l.baseIntensity, 0.1);
          (l.fixture.material as THREE.MeshBasicMaterial).color.set(0xfff176);
        }
      });

      // Animate other players
      Object.keys(otherPlayers).forEach(id => {
        const p = otherPlayers[id];
        const dist = p.model.position.distanceTo(p.lastPos);
        if (dist > 0.01) {
          const t = time * 0.01;
          const leftLeg = p.model.getObjectByName("leftLeg");
          const rightLeg = p.model.getObjectByName("rightLeg");
          const leftArm = p.model.getObjectByName("leftArm");
          const rightArm = p.model.getObjectByName("rightArm");
          
          if (leftLeg) leftLeg.rotation.x = Math.sin(t) * 0.5;
          if (rightLeg) rightLeg.rotation.x = Math.sin(t + Math.PI) * 0.5;
          if (leftArm) leftArm.rotation.x = Math.sin(t + Math.PI) * 0.5;
          if (rightArm) rightArm.rotation.x = Math.sin(t) * 0.5;
          
          p.lastPos.copy(p.model.position);
        }
      });

      if (controls.isLocked) {
        const delta = (time - prevTime) / 1000;
        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;

        direction.z = Number(moveState.forward) - Number(moveState.backward);
        direction.x = Number(moveState.right) - Number(moveState.left);
        direction.normalize();

        const speedMultiplier = moveState.shift ? 110.0 : 60.0;
        if (moveState.forward || moveState.backward) velocity.z -= direction.z * speedMultiplier * delta;
        if (moveState.left || moveState.right) velocity.x -= direction.x * speedMultiplier * delta;

        const oldPos = camera.position.clone();
        
        controls.moveRight(-velocity.x * delta);
        if (checkCollision(camera.position)) camera.position.x = oldPos.x;
        
        controls.moveForward(-velocity.z * delta);
        if (checkCollision(camera.position)) camera.position.z = oldPos.z;

        if (moveState.forward || moveState.backward || moveState.left || moveState.right) {
          const bobFreq = moveState.shift ? 0.015 : 0.01;
          const bobAmp = moveState.shift ? 0.08 : 0.04;
          camera.position.y = 1.6 + Math.sin(time * bobFreq) * bobAmp;
        } else {
          camera.position.y = THREE.MathUtils.lerp(camera.position.y, 1.6, 0.1);
        }

        if (time - lastEmitTime > 50) {
          socketRef.current?.emit('playerUpdate', {
            x: camera.position.x,
            y: 0,
            z: camera.position.z,
            ry: camera.rotation.y
          });
          lastEmitTime = time;
        }
      }

      prevTime = time;
      renderer.render(scene, camera);
    };

    animate();

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      controls.removeEventListener('lock', onLock);
      controls.removeEventListener('unlock', onUnlock);
      socketRef.current?.disconnect();
      if (containerRef.current) containerRef.current.removeChild(renderer.domElement);
    };
  }, []);

  const handleStart = () => {
    if (controlsRef.current) {
      controlsRef.current.lock();
    }
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden font-mono select-none">
      <div ref={containerRef} className="w-full h-full" />
      
      <div className="absolute inset-0 pointer-events-none opacity-[0.12] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] bg-repeat" />
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent via-black/5 to-transparent animate-scanline" />
      <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_200px_rgba(0,0,0,1)]" />
      
      <div className="absolute inset-0 pointer-events-none border-[40px] border-black/20 blur-3xl" />

      <div className="absolute top-8 left-8 text-yellow-500/80 text-xl tracking-widest uppercase flex items-center gap-2 font-bold">
        <div className="w-3 h-3 bg-red-600 rounded-full animate-pulse shadow-[0_0_10px_rgba(220,38,38,0.8)]" />
        REC
      </div>
      
      <div className="absolute top-8 right-8 text-yellow-500/60 text-xs flex flex-col items-end gap-1">
        <span className="bg-black/40 px-2 py-1 rounded">PLAYERS: {playerCount}</span>
        <span className="bg-black/40 px-2 py-1 rounded">SIGNAL: WEAK</span>
      </div>

      <div className="absolute bottom-8 left-8 text-yellow-500/40 text-[10px] flex flex-col gap-1">
        <span>LEVEL 0: THE LOBBY</span>
        <span>ASYNC FOUNDATION - HAZMAT UNIT 04</span>
      </div>
      
      <div className="absolute bottom-8 right-8 text-yellow-500/40 text-[10px] text-right">
        <span>{new Date().toLocaleDateString()}</span><br />
        <span>{new Date().toLocaleTimeString()}</span>
      </div>

      {showStart && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/98 z-50 text-center p-6">
          <div className="mb-16 space-y-4">
            <h1 className="text-7xl md:text-9xl text-yellow-600 tracking-tighter font-black italic drop-shadow-2xl">THE BACKROOMS</h1>
            <div className="h-0.5 w-full bg-yellow-900/40" />
            <p className="text-yellow-600/30 text-[12px] tracking-[0.8em] uppercase font-light">Found Footage Experience</p>
          </div>
          
          <p className="text-yellow-700/50 mb-16 max-w-xl leading-relaxed text-sm md:text-base italic font-serif">
            "If you're not careful and you noclip out of reality in the wrong areas, you'll end up in the Backrooms..."
          </p>
          
          <button 
            onClick={handleStart}
            className="group relative px-20 py-8 bg-transparent border border-yellow-600/50 text-yellow-600 overflow-hidden transition-all duration-500 hover:border-yellow-500"
          >
            <div className="absolute inset-0 bg-yellow-600 translate-y-full group-hover:translate-y-0 transition-transform duration-500 ease-out" />
            <span className="relative z-10 text-4xl font-black tracking-[0.2em] uppercase group-hover:text-black transition-colors duration-500">Noclip In</span>
          </button>
          
          <div className="mt-20 grid grid-cols-2 gap-16 text-yellow-800/30 text-[11px] uppercase tracking-[0.4em] font-bold">
            <div className="flex flex-col gap-3">
              <span className="text-yellow-600/40">Movement</span>
              <span>WASD / ARROWS</span>
            </div>
            <div className="flex flex-col gap-3">
              <span className="text-yellow-600/40">View</span>
              <span>MOUSE LOOK</span>
            </div>
          </div>
        </div>
      )}

      {isLocked && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none opacity-20">
          <div className="w-8 h-[1px] bg-white" />
          <div className="h-8 w-[1px] bg-white absolute" />
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes scanline {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100%); }
        }
        .animate-scanline {
          animation: scanline 12s linear infinite;
        }
        canvas { display: block; }
        body { background: black; }
      `}} />
    </div>
  );
}
