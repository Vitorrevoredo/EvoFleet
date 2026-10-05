window.EvoGenetics = (() => {
  const GENE_DEFS = {
    speed:       { min: 65,   max: 320, label: "Velocidade" },
    size:        { min: 10,   max: 36,  label: "Tamanho" },
    fireRate:    { min: 0.30, max: 2.80,label: "Cadência" },
    accuracy:    { min: 0.08, max: 0.99,label: "Precisão" },
    aggression:  { min: 0.05, max: 1.0, label: "Agressividade" },
    strafe:      { min: 0.0,  max: 1.0, label: "Strafe" },
    evade:       { min: 0.0,  max: 1.0, label: "Esquiva" }
  };

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const rand = (min, max) => min + Math.random() * (max - min);

  function randomGenome() {
    const genome = {};
    for (const [name, def] of Object.entries(GENE_DEFS)) genome[name] = rand(def.min, def.max);
    return genome;
  }

  function copyGenome(g) {
    return Object.fromEntries(Object.entries(g).map(([k,v]) => [k,v]));
  }

  function crossover(a, b) {
    const child = {};
    for (const name of Object.keys(GENE_DEFS)) {
      const mode = Math.random();
      if (mode < 0.40) child[name] = a[name];
      else if (mode < 0.80) child[name] = b[name];
      else child[name] = (a[name] + b[name]) / 2;
    }
    return child;
  }

  function mutate(genome, mutationRate) {
    const out = copyGenome(genome);
    for (const [name, def] of Object.entries(GENE_DEFS)) {
      if (Math.random() < mutationRate) {
        const span = def.max - def.min;
        const delta = (Math.random() * 2 - 1) * span * 0.32;
        out[name] = clamp(out[name] + delta, def.min, def.max);
      }
    }
    return out;
  }

  function tournament(scored, size = 3) {
    let best = null;
    for (let i = 0; i < size; i++) {
      const candidate = scored[Math.floor(Math.random() * scored.length)];
      if (!best || candidate.fitness > best.fitness) best = candidate;
    }
    return best;
  }

  function evolve(scored, populationSize, crossoverRate, mutationRate) {
    const sorted = [...scored].sort((a,b) => b.fitness - a.fitness);
    const next = [];
    const eliteCount = Math.max(1, Math.floor(populationSize * 0.10));

    for (let i = 0; i < Math.min(eliteCount, sorted.length); i++) next.push(copyGenome(sorted[i].genome));

    let showcaseParents = null;
    while (next.length < populationSize) {
      const pa = tournament(sorted);
      const pb = tournament(sorted);
      if (!showcaseParents) showcaseParents = [pa, pb];
      let child = Math.random() < crossoverRate
        ? crossover(pa.genome, pb.genome)
        : copyGenome(Math.random() < 0.5 ? pa.genome : pb.genome);
      child = mutate(child, mutationRate);
      next.push(child);
    }

    return {
      population: next,
      eliteCount,
      parents: showcaseParents || [sorted[0], sorted[Math.min(1, sorted.length - 1)]]
    };
  }

  function normalized(name, value) {
    const def = GENE_DEFS[name];
    return clamp((value - def.min) / (def.max - def.min), 0, 1);
  }

  function phenotype(genome) {
    const n = name => normalized(name, genome[name]);
    const scores = {
      CACADOR: n('aggression') * 1.25 + n('speed') * 0.65,
      ATIRADOR: n('accuracy') * 1.15 + n('fireRate') * 0.65,
      TANQUE: n('size') * 1.30 + (1 - n('speed')) * 0.30,
      ACROBATA: n('evade') * 1.10 + n('strafe') * 0.95
    };
    return Object.entries(scores).sort((a,b) => b[1]-a[1])[0][0];
  }

  return { GENE_DEFS, randomGenome, copyGenome, crossover, mutate, tournament, evolve, normalized, phenotype };
})();
