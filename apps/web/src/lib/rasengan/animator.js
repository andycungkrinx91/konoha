export function updateThemeTransition(ctx, dt, rotMultiplier) {
  const p = Math.min(1.0, (performance.now() - ctx.themeTransitionStartedAt) / (ctx.themeTransitionDuration * 1000));
  const lightPeak = Math.max(0, 1.0 - p * 1.3);

  if (ctx.supernovaGroup) ctx.supernovaGroup.visible = true;
  if (ctx.supernovaLightGlow) {
    ctx.supernovaLightGlow.scale.setScalar(0.4 + p * 2.2);
    ctx.supernovaLightGlow.material.opacity = Math.max(0, 1.0 - p * 1.25) * 0.9;
  }
  if (ctx.supernovaCore) {
    ctx.supernovaCore.scale.setScalar(0.2 + p * 5.5);
    ctx.supernovaCore.material.opacity = Math.max(0, 1.0 - p * 1.3) * (ctx.isLight ? 0.88 : 0.95);
  }
  if (ctx.supernovaRings) {
    ctx.supernovaRings.forEach((ring) => {
      ring.scale.setScalar(Math.max(0.1, p * (4.2 + ring.userData.speed)));
      ring.material.opacity = Math.max(0, 1.0 - p * 1.2) * (ctx.isLight ? 0.85 : 0.95);
      ring.rotation.x += dt * 2.0;
      ring.rotation.y += dt * 2.5;
    });
  }
  if (ctx.supernovaRaysGroup && ctx.supernovaRays) {
    ctx.supernovaRaysGroup.rotation.y += dt * 4.0;
    ctx.supernovaRays.forEach((ray) => {
      ray.scale.setScalar(0.2 + p * 3.8);
      ray.material.opacity = Math.max(0, 1.0 - p * 1.2);
    });
  }
  if (ctx.flash) ctx.flash.intensity = lightPeak * 45;
  if (ctx.windNode) ctx.windNode.rotation.y += dt * 14.0 * rotMultiplier;
  if (ctx.rasenganNode) ctx.rasenganNode.rotation.y -= dt * 10.0 * rotMultiplier;
  if (ctx.rasenshurikenGroup) {
    ctx.rasenshurikenGroup.rotation.y += dt * 8.0 * rotMultiplier;
    ctx.rasenshurikenGroup.rotation.z += dt * 3.5 * rotMultiplier;
    ctx.rasenshurikenGroup.scale.setScalar(ctx.isPostLogin ? 4.2 : 3.2);
  }

  if (p >= 1.0) {
    ctx.isThemeTransitioning = false;
    if (ctx.supernovaGroup) ctx.supernovaGroup.visible = !ctx.isPostLogin;
    if (ctx.supernovaLightGlow) ctx.supernovaLightGlow.material.opacity = 0;
    if (ctx.flash) ctx.flash.intensity = 0;
    if (ctx.rasenshurikenGroup) ctx.rasenshurikenGroup.scale.setScalar(ctx.isPostLogin ? 4.2 : 3.2);
  }
}

export function updatePostLogin(ctx, dt, t, rotMultiplier) {
  ctx.phase = 'COSMIC_ORBIT';
  if (!ctx.isThemeTransitioning) {
    if (ctx.supernovaGroup) ctx.supernovaGroup.visible = false;
    if (ctx.flash) ctx.flash.intensity = 0;
  }

  if (ctx.rasenshurikenGroup) {
    ctx.rasenshurikenGroup.scale.setScalar(4.2);
    ctx.rasenshurikenGroup.position.y = Math.sin(t * 0.4) * 0.08;
    ctx.rasenshurikenGroup.position.x = Math.cos(t * 0.3) * 0.05;
    ctx.rasenshurikenGroup.rotation.x = 0.48 + Math.sin(t * 0.35) * 0.02;
    ctx.rasenshurikenGroup.rotation.z = Math.sin(t * 0.25) * 0.015;

    if (ctx.windNode && !ctx.isThemeTransitioning) {
      ctx.windNode.rotation.y += dt * 1.0 * rotMultiplier;
    }
    if (ctx.rasenganNode) {
      ctx.rasenganNode.rotation.y -= dt * 0.8 * rotMultiplier;
      ctx.rasenganNode.rotation.x += dt * 0.4 * rotMultiplier;
      ctx.rasenganNode.rotation.z += dt * 0.2 * rotMultiplier;
    }
    if (ctx.effectNode) {
      ctx.effectNode.rotation.y += dt * 0.6 * rotMultiplier;
      ctx.effectNode.scale.setScalar(1.0 + Math.sin(t * 1.5) * 0.02);
    }
  }

  ctx.camera.position.x = Math.sin(t * 0.2) * 0.12;
  ctx.camera.position.y = 0.35 + Math.sin(t * 0.28) * 0.08;
  ctx.camera.position.z = 9.6 + Math.sin(t * 0.16) * 0.12;
  ctx.camera.lookAt(0, 0, 0);

  ctx.coreGroup.scale.setScalar(0.4);
  ctx.coreGroup.rotation.y += dt * 0.6 * rotMultiplier;

  const positions = ctx.particlePositions;
  for (let i = 0; i < ctx.particleCount; i++) {
    const k = i * 3;
    const velScale = 0.08 * dt * rotMultiplier;
    positions[k] += ctx.particleVelocities[k] * velScale;
    positions[k + 1] += ctx.particleVelocities[k + 1] * velScale;
    positions[k + 2] += ctx.particleVelocities[k + 2] * velScale;
    if (Math.hypot(positions[k], positions[k + 1]) > 3.0 || Math.abs(positions[k + 2]) > 3.5) {
      ctx.resetParticle(i);
    }
  }
  ctx.particles.geometry.attributes.position.needsUpdate = true;
  ctx.particles.material.opacity = ctx.isLight ? 0.6 : 0.75;
  ctx.particles.material.size = ctx.isLight ? 0.028 : 0.022;

  if (ctx.bloom) {
    ctx.bloom.strength = 1.15;
  }
  return ctx.phase;
}

function calculatePhaseTimings(t, dur) {
  const chargeEnd = dur * (3.6 / 8.0);
  const singularityEnd = dur * (4.5 / 8.0);
  const blastEnd = dur * (6.6 / 8.0);
  const recoveryEnd = dur;

  if (t < chargeEnd) {
    const p = t / chargeEnd;
    return {
      phase: 'CHARGING',
      coreScale: 0.1 + 0.9 * Math.pow(p, 1.4),
      particleSpread: 0.5 + p * 0.5,
      supernovaOpacity: 0,
      flash: 0,
      p, chargeEnd, singularityEnd, blastEnd, recoveryEnd
    };
  }
  if (t < singularityEnd) {
    const p = (t - chargeEnd) / (singularityEnd - chargeEnd);
    return {
      phase: 'SINGULARITY',
      coreScale: Math.max(0.65, 1.0 - p * 0.35 + Math.sin(t * 24) * 0.03),
      particleSpread: Math.max(0.3, 1.0 - p * 0.6),
      supernovaOpacity: p * 0.7,
      flash: 0.2 + p * 0.5,
      p, chargeEnd, singularityEnd, blastEnd, recoveryEnd
    };
  }
  if (t < blastEnd) {
    const p = (t - singularityEnd) / (blastEnd - singularityEnd);
    return {
      phase: 'SUPERNOVA',
      coreScale: Math.max(0.04, 0.7 * (1 - p * 0.7) + 0.04),
      particleSpread: 1.0 + p * 4.5,
      supernovaOpacity: Math.max(0, 1.0 - p * 1.3),
      flash: Math.max(0, 1.0 - p * 1.8) * 3.5,
      p, chargeEnd, singularityEnd, blastEnd, recoveryEnd
    };
  }
  const p = Math.min(1, (t - blastEnd) / (recoveryEnd - blastEnd));
  return {
    phase: 'RECOVERY',
    coreScale: 0.4 + p * 0.6,
    particleSpread: 5.5 * (1 - p) + 1.0,
    supernovaOpacity: 0,
    flash: 0,
    p, chargeEnd, singularityEnd, blastEnd, recoveryEnd
  };
}

function updateRingElement(ring, ringParams) {
  const { isSupernova, p, t, rotMultiplier, isLight } = ringParams;
  if (!isSupernova) {
    ring.scale.setScalar(0.01);
    ring.material.opacity = 0;
    return;
  }
  const ringScale = Math.max(0.05, (p - ring.userData.delay) * (4.2 + ring.userData.speed));
  ring.scale.setScalar(ringScale);
  ring.material.opacity = Math.max(0, 1.0 - p * 1.2) * (isLight ? 0.8 : 0.9);
  ring.rotation.x = ring.userData.baseRotX + t * 0.8 * rotMultiplier;
  ring.rotation.y = ring.userData.baseRotY + t * 1.1 * rotMultiplier;
}

function updateRayElement(ray, rayParams) {
  const { isSupernova, p, isLight } = rayParams;
  if (!isSupernova) {
    ray.scale.setScalar(0.01);
    ray.material.opacity = 0;
    return;
  }
  ray.scale.setScalar(0.1 + p * (3.0 + ray.userData.speed));
  ray.material.opacity = Math.max(0, 1.0 - p * 1.3) * (isLight ? 0.75 : 0.85);
}

function updateLoginSupernovaCore(ctx, params) {
  const { phase, p, supernovaOpacity } = params;
  if (!ctx.supernovaCore) return;

  if (phase === 'SUPERNOVA') {
    ctx.supernovaCore.scale.setScalar(0.2 + p * 5.2);
    ctx.supernovaCore.material.opacity = supernovaOpacity * (ctx.isLight ? 0.88 : 0.95);
    return;
  }
  if (phase === 'SINGULARITY') {
    ctx.supernovaCore.scale.setScalar(0.1 + p * 0.5);
    ctx.supernovaCore.material.opacity = supernovaOpacity * 0.7;
    return;
  }
  ctx.supernovaCore.scale.setScalar(0.01);
  ctx.supernovaCore.material.opacity = 0;
}

function updateLoginSupernova(ctx, step, params) {
  const { dt, t, rotMultiplier } = step;
  const { phase, p, flash } = params;
  const isSupernova = phase === 'SUPERNOVA';

  if (ctx.supernovaLightGlow) {
    ctx.supernovaLightGlow.scale.setScalar(isSupernova ? 0.4 + p * 2.0 : 0.01);
    ctx.supernovaLightGlow.material.opacity = isSupernova ? Math.max(0, 1.0 - p * 1.2) * 0.9 : 0;
  }

  updateLoginSupernovaCore(ctx, params);

  if (ctx.supernovaRings) {
    const ringParams = { isSupernova, p, t, rotMultiplier, isLight: ctx.isLight };
    ctx.supernovaRings.forEach((r) => updateRingElement(r, ringParams));
  }

  if (ctx.supernovaRaysGroup && ctx.supernovaRays) {
    if (isSupernova) {
      ctx.supernovaRaysGroup.rotation.y += dt * 0.9 * rotMultiplier;
      ctx.supernovaRaysGroup.rotation.z += dt * 0.6 * rotMultiplier;
    }
    const rayParams = { isSupernova, p, isLight: ctx.isLight };
    ctx.supernovaRays.forEach((ray) => updateRayElement(ray, rayParams));
  }

  ctx.flash.intensity = flash * 45;
}

function updateLoginRasenshuriken(ctx, step, params) {
  if (!ctx.rasenshurikenGroup) return;
  const { dt, t, rotMultiplier } = step;
  const { phase, chargeEnd, singularityEnd } = params;

  const shurikenScale = phase === 'SUPERNOVA'
    ? Math.max(1.8, 3.2 * (1.0 + Math.sin((t - singularityEnd) * 1.2) * 0.15))
    : phase === 'SINGULARITY'
      ? Math.max(2.2, 3.2 - (t - chargeEnd) * 0.5)
      : 3.2;

  ctx.rasenshurikenGroup.scale.setScalar(shurikenScale);
  ctx.rasenshurikenGroup.position.y = Math.sin(t * 1.2) * 0.05;
  ctx.rasenshurikenGroup.rotation.x = 0.52 + Math.sin(t * 0.8) * 0.018;
  ctx.rasenshurikenGroup.rotation.z = Math.sin(t * 0.6) * 0.012;

  if (ctx.windNode && !ctx.isThemeTransitioning) {
    const windSpeed = (phase === 'SUPERNOVA' ? 4.8 : phase === 'SINGULARITY' ? 3.6 : 2.6);
    ctx.windNode.rotation.y += dt * windSpeed * rotMultiplier;
  }

  if (ctx.rasenganNode) {
    ctx.rasenganNode.rotation.y -= dt * 2.2 * rotMultiplier;
    ctx.rasenganNode.rotation.x += dt * 1.0 * rotMultiplier;
    ctx.rasenganNode.rotation.z += dt * 0.6 * rotMultiplier;
  }

  if (ctx.effectNode) {
    ctx.effectNode.rotation.y += dt * 1.8 * rotMultiplier;
    const pulse = 1.0 + Math.sin(t * 2.5) * 0.025;
    ctx.effectNode.scale.set(pulse, 1.0, pulse);
  }
}

function updateLoginParticles(ctx, dt, params, rotMultiplier) {
  const { phase, coreScale, particleSpread } = params;
  const positions = ctx.particlePositions;
  for (let i = 0; i < ctx.particleCount; i++) {
    const k = i * 3;
    const velScale = (phase === 'SUPERNOVA' ? 2.2 : phase === 'CHARGING' ? -0.06 : 0.15) * dt * rotMultiplier;
    positions[k] += ctx.particleVelocities[k] * velScale * particleSpread;
    positions[k + 1] += ctx.particleVelocities[k + 1] * velScale * particleSpread;
    positions[k + 2] += ctx.particleVelocities[k + 2] * velScale;
    const limit = 2.2 + particleSpread * 0.8;
    if (Math.hypot(positions[k], positions[k + 1]) > limit || Math.abs(positions[k + 2]) > 3.5) {
      ctx.resetParticle(i);
    }
    if (phase === 'CHARGING') {
      positions[k] *= 1 - dt * 0.08;
      positions[k + 1] *= 1 - dt * 0.08;
    }
  }
  ctx.particles.geometry.attributes.position.needsUpdate = true;
  ctx.particles.material.opacity = phase === 'SUPERNOVA' ? 0.98 : (ctx.isLight ? 0.75 + coreScale * 0.2 : 0.55 + coreScale * 0.3);
  ctx.particles.material.size = phase === 'SUPERNOVA' ? 0.042 : (ctx.isLight ? 0.035 : 0.024);
}

export function updateLoginCycle(ctx, dt, t, rotMultiplier) {
  const params = calculatePhaseTimings(t, 8.0);
  ctx.phase = params.phase;

  if (t >= params.recoveryEnd && ctx.options.autoLoop) {
    ctx.elapsed = 0;
  }

  if (ctx.options.onPhaseChange && ctx.lastReportedPhase !== ctx.phase) {
    ctx.lastReportedPhase = ctx.phase;
    ctx.options.onPhaseChange(ctx.phase);
  }

  const step = { dt, t, rotMultiplier };
  updateLoginRasenshuriken(ctx, step, params);

  if (!ctx.isThemeTransitioning) {
    updateLoginSupernova(ctx, step, params);
  }

  ctx.coreGroup.scale.setScalar(params.coreScale);
  ctx.coreGroup.rotation.y += dt * (ctx.phase === 'CHARGING' ? 1.2 : 2.0) * rotMultiplier;
  ctx.coreGroup.rotation.x += dt * 0.4 * rotMultiplier;
  ctx.ringGroup.rotation.x += dt * 0.2 * rotMultiplier;
  ctx.ringGroup.rotation.y -= dt * 0.35 * rotMultiplier;

  ctx.rings.forEach((ring, i) => {
    ring.scale.setScalar(0.65 + params.coreScale * 0.6 + Math.sin(t * 2.5 + i) * 0.03);
    ring.material.opacity = ctx.isLight ? (0.35 + params.coreScale * 0.45) : (0.22 + params.coreScale * 0.5);
  });

  ctx.coreGlow.material.opacity = ctx.isLight ? Math.min(0.65, 0.25 + params.coreScale * 0.35) : Math.min(0.55, 0.15 + params.coreScale * 0.35);
  ctx.outerGlow.material.opacity = ctx.isLight ? Math.min(0.35, 0.1 + params.coreScale * 0.2) : Math.min(0.22, 0.04 + params.coreScale * 0.12);

  updateLoginParticles(ctx, dt, params, rotMultiplier);

  if (ctx.stars) {
    ctx.stars.rotation.y += dt * 0.0015 * rotMultiplier;
  }

  ctx.camera.position.x = Math.sin(t * 0.5) * 0.04;
  ctx.camera.position.y = 0.35 + Math.sin(t * 0.8) * 0.025;
  ctx.camera.position.z = ctx.phase === 'SUPERNOVA' ? 9.6 - params.flash * 0.15 : 9.6;
  ctx.camera.lookAt(0, 0, 0);

  if (ctx.bloom) {
    ctx.bloom.strength = ctx.phase === 'SUPERNOVA' ? 1.85 : ctx.phase === 'SINGULARITY' ? 1.4 : 1.15;
  }

  return ctx.phase;
}
