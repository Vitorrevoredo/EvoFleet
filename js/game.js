(() => {
  const G = window.EvoGenetics;
  const canvas = document.querySelector('#gameCanvas');
  const ctx = canvas.getContext('2d');

  const ui = Object.fromEntries([
    'generationValue','playerHpText','playerHpBar','scoreValue','timerValue','aliveValue',
    'liveBestFitness','statusText','populationHud','crossoverHud','mutationHud','geneBars',
    'championBadge','fitnessChart','evolutionLog','startOverlay','generationOverlay',
    'generationSummaryTitle','generationSummaryText','summaryBestFitness','summaryAverageFitness',
    'summaryMutation','parentAName','parentAFitness','parentBName','parentBFitness','offspringText',
    'populationInput','populationOut','crossoverInput','crossoverOut','mutationInput','mutationOut',
    'durationInput','durationOut','startBtn','nextGenerationBtn','pauseBtn','resetBtn',
    'playerStats','shopItems','shopCredits','shipLevelValue','scenarioABtn','scenarioBBtn','labReadout','exportMetricsBtn'
  ].map(id => [id, document.querySelector('#' + id)]));

  const W = canvas.width;
  const H = canvas.height;
  const keys = new Set();
  const mouse = { x: W/2, y: H/2, down:false };
  let raf = 0;
  let lastTs = 0;
  let paused = false;
  let state = 'menu';
  let generation = 1;
  let generationTime = 25;
  let generationRemaining = generationTime;
  let populationSize = 12;
  let crossoverRate = 0.80;
  let mutationRate = 0.05;
  let genomes = [];
  let enemies = [];
  let playerBullets = [];
  let enemyBullets = [];
  let particles = [];
  let stars = [];
  let score = 0;
  let history = [];
  let generationRecords = [];
  let player = null;
  let playerFireCooldown = 0;
  let pendingEvolution = null;
  let metricsLog = [];
  let selectedScenario = 'LIVRE';
  let activeConfig = null;
  let playerBuild = { hp:0, speed:0, damage:0, fireRate:0, bulletSpeed:0, multishot:0, shield:0 };

  const UPGRADE_DEFS = {
    hp:          { code:'HP',  name:'Blindagem',      max:6, baseCost:120, step:65, description:'+20 de vida máxima' },
    speed:       { code:'SPD', name:'Motor Turbo',    max:6, baseCost:100, step:55, description:'+12% de velocidade' },
    damage:      { code:'DMG', name:'Canhão Pesado',  max:6, baseCost:140, step:75, description:'+18% de dano' },
    fireRate:    { code:'ROF', name:'Disparo Rápido', max:6, baseCost:130, step:70, description:'+16% de cadência' },
    bulletSpeed: { code:'PLS', name:'Plasma',         max:6, baseCost:110, step:60, description:'+90 velocidade do tiro' },
    multishot:   { code:'DUO', name:'Canhão Extra',   max:2, baseCost:280, step:220, description:'+1 projétil por disparo' },
    shield:      { code:'DEF', name:'Escudo',         max:6, baseCost:160, step:85, description:'-8% de dano recebido' }
  };

  const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
  const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const lerp = (a,b,t) => a+(b-a)*t;
  const rand = (a,b) => a + Math.random()*(b-a);

  function createStars() {
    stars = Array.from({length:190},()=>({x:Math.random()*W,y:Math.random()*H,z:rand(.25,1),tw:Math.random()*Math.PI*2}));
  }

  function resetPlayer() {
    const maxHp = 100 + playerBuild.hp * 20;
    player = { x:W/2, y:H*.72, vx:0, vy:0, angle:-Math.PI/2, hp:maxHp, maxHp, radius:18, invuln:0, boost:100 };
    playerBullets = [];
    enemyBullets = [];
    particles = [];
    playerFireCooldown = 0;
    renderPlayerStats();
  }

  function spawnEnemy(genome, index) {
    const side = index % 4;
    let x,y;
    if (side===0) { x=rand(70,W-70); y=rand(45,100); }
    else if(side===1){ x=rand(45,100); y=rand(80,H*.55); }
    else if(side===2){ x=rand(W-100,W-45); y=rand(80,H*.55); }
    else { x=rand(70,W-70); y=rand(45,120); }

    return {
      id:index+1,
      name:`EF-${generation}.${String(index+1).padStart(2,'0')}`,
      genome:G.copyGenome(genome),
      x,y,vx:0,vy:0,angle:0,
      radius:genome.size,
      hp: 38 + genome.size*1.4,
      maxHp: 38 + genome.size*1.4,
      alive:true,
      age:0,
      fireCooldown:rand(.1,1),
      shots:0,hits:0,damage:0,
      proximityTime:0,
      survival:0,
      fitness:0,
      strafePhase:Math.random()*Math.PI*2,
      evadeCooldown:rand(.15,.9),
      evadeBurst:0,
      phenotype:G.phenotype(genome),
      trail:[],
      hitFlash:0
    };
  }

  function prepareInitialPopulation() {
    genomes = Array.from({length:populationSize},()=>G.randomGenome());
  }

  function totalShipLevel() {
    return Object.values(playerBuild).reduce((sum,v)=>sum+v,0);
  }

  function renderPlayerStats() {
    if (!ui.playerStats) return;
    const stats = [
      ['VIDA', 100 + playerBuild.hp*20],
      ['VEL', `${Math.round((1 + playerBuild.speed*.12)*100)}%`],
      ['DANO', `${Math.round((1 + playerBuild.damage*.18)*100)}%`],
      ['TIRO', `${Math.round((1 + playerBuild.fireRate*.16)*100)}%`],
      ['ARMAS', 1 + playerBuild.multishot],
      ['ESCUDO', `${playerBuild.shield*8}%`],
      ['CRÉDITOS', score]
    ];
    ui.playerStats.innerHTML = stats.map(([label,value])=>`<div class="ship-stat"><span>${label}</span><strong>${value}</strong></div>`).join('');
    if (ui.shipLevelValue) ui.shipLevelValue.textContent = `LV ${1 + totalShipLevel()}`;
  }

  function upgradeCost(id) {
    const def = UPGRADE_DEFS[id];
    return def.baseCost + playerBuild[id] * def.step;
  }

  function renderShop() {
    if (!ui.shopItems) return;
    ui.shopCredits.textContent = score;
    ui.shopItems.innerHTML = '';
    for (const [id,def] of Object.entries(UPGRADE_DEFS)) {
      const level = playerBuild[id];
      const maxed = level >= def.max;
      const price = upgradeCost(id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `shop-item ${maxed ? 'maxed' : ''}`;
      btn.disabled = maxed || score < price;
      btn.innerHTML = `<span class="shop-code">${def.code}</span><span class="shop-copy"><strong>${def.name}</strong><small>${def.description} · LV ${level}/${def.max}</small></span><span class="shop-price">${maxed ? 'MAX' : price + ' C'}</span>`;
      btn.addEventListener('click', () => buyUpgrade(id));
      ui.shopItems.appendChild(btn);
    }
  }

  function buyUpgrade(id) {
    const def = UPGRADE_DEFS[id];
    if (!def || playerBuild[id] >= def.max) return;
    const price = upgradeCost(id);
    if (score < price) return;
    score -= price;
    playerBuild[id]++;
    addLog(`<strong>OFICINA</strong> — ${def.name} LV ${playerBuild[id]} comprado por ${price} créditos.`);
    renderPlayerStats();
    renderShop();
    syncHud();
  }

  function populationDiversity(records) {
    if (!records.length) return 0;
    let total = 0;
    let genes = 0;
    for (const [name,def] of Object.entries(G.GENE_DEFS)) {
      const vals = records.map(r => G.normalized(name, r.genome[name]));
      const mean = vals.reduce((a,b)=>a+b,0) / vals.length;
      const variance = vals.reduce((s,v)=>s+(v-mean)*(v-mean),0) / vals.length;
      total += Math.sqrt(variance);
      genes++;
    }
    return genes ? (total/genes)*100 : 0;
  }

  function renderLabReadout() {
    if (!ui.labReadout) return;
    const last = metricsLog[metricsLog.length-1];
    if (!last) {
      ui.labReadout.textContent = `${selectedScenario==='LIVRE'?'Modo livre':'Cenário '+selectedScenario} · nenhum teste registrado.`;
      return;
    }
    ui.labReadout.textContent = `${last.scenario} · G${last.generation} · AG ${last.evolutionMs.toFixed(3)} ms · melhor ${Math.round(last.best)} · média ${Math.round(last.avg)} · diversidade ${last.diversity.toFixed(1)}%`;
  }

  function setScenario(label) {
    const presets = {
      A:{population:10,crossover:70,mutation:3,duration:20},
      B:{population:22,crossover:90,mutation:15,duration:20}
    };
    const p = presets[label];
    if (!p) return;
    selectedScenario = label;
    ui.populationInput.value=p.population;
    ui.crossoverInput.value=p.crossover;
    ui.mutationInput.value=p.mutation;
    ui.durationInput.value=p.duration;
    syncRangeOutputs();
    ui.scenarioABtn.classList.toggle('active',label==='A');
    ui.scenarioBBtn.classList.toggle('active',label==='B');
    renderLabReadout();
    addLog(`<strong>TESTE ${label}</strong> — parâmetros preparados para a próxima geração.`);
  }

  function exportMetrics() {
    if (!metricsLog.length) { addLog('<strong>LAB</strong> — execute pelo menos uma geração antes de exportar.'); return; }
    const header=['cenario','geracao','populacao','crossover_pct','mutacao_pct','duracao_s','melhor_fitness','fitness_medio','diversidade_pct','tempo_ag_ms'];
    const rows=metricsLog.map(m=>[m.scenario,m.generation,m.population,m.crossover,m.mutation,m.duration,m.best.toFixed(2),m.avg.toFixed(2),m.diversity.toFixed(2),m.evolutionMs.toFixed(4)]);
    const csv='\uFEFF'+[header,...rows].map(r=>r.join(';')).join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download='evofleet_metricas.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  function beginGeneration() {
    populationSize = Number(ui.populationInput.value);
    crossoverRate = Number(ui.crossoverInput.value)/100;
    mutationRate = Number(ui.mutationInput.value)/100;
    generationTime = Number(ui.durationInput.value);
    generationRemaining = generationTime;
    activeConfig = {scenario:selectedScenario,population:populationSize,crossover:Math.round(crossoverRate*100),mutation:Math.round(mutationRate*100),duration:generationTime};

    if (!genomes.length || genomes.length !== populationSize) {
      if (!genomes.length) genomes = Array.from({length:populationSize},()=>G.randomGenome());
      else {
        const sorted = generationRecords.length ? [...generationRecords].sort((a,b)=>b.fitness-a.fitness) : [];
        const resized = [];
        for (let i=0;i<populationSize;i++) {
          if (i<genomes.length) resized.push(G.copyGenome(genomes[i]));
          else if (sorted.length) resized.push(G.mutate(sorted[i%sorted.length].genome, mutationRate));
          else resized.push(G.randomGenome());
        }
        genomes = resized;
      }
    }

    resetPlayer();
    enemies = genomes.map((g,i)=>spawnEnemy(g,i));
    generationRecords = [];
    state='playing';
    ui.nextGenerationBtn.disabled = true;
    paused=false;
    ui.pauseBtn.textContent='Pausar';
    ui.startOverlay.classList.remove('show');
    ui.generationOverlay.classList.remove('show');
    ui.statusText.textContent='Combate em andamento';
    syncHud();
  }

  function calculateFitness(e) {
    const survivalScore = e.survival * 1.8;
    const damageScore = e.damage * 7.0;
    const accuracyScore = e.hits * 12.0;
    const hitRateBonus = e.shots > 0 ? (e.hits/e.shots)*80 : 0;
    const pressureScore = e.proximityTime * 2.4;
    return Math.max(1, survivalScore + damageScore + accuracyScore + hitRateBonus + pressureScore);
  }

  function endGeneration(reason='tempo encerrado') {
    if (state !== 'playing') return;
    state='between';
    for (const e of enemies) {
      e.survival = Math.min(generationTime,e.age);
      e.fitness = calculateFitness(e);
    }
    const records = enemies.map(e=>({name:e.name,fitness:e.fitness,genome:G.copyGenome(e.genome),damage:e.damage,hits:e.hits,shots:e.shots,survival:e.survival}));
    records.sort((a,b)=>b.fitness-a.fitness);
    generationRecords = records;
    const avg = records.reduce((s,r)=>s+r.fitness,0)/Math.max(1,records.length);
    const best = records[0];
    history.push({generation,best:best.fitness,avg});
    if (history.length>24) history.shift();

    const diversity = populationDiversity(records);
    const evolveStart = performance.now();
    pendingEvolution = G.evolve(records,populationSize,crossoverRate,mutationRate);
    const evolutionMs = performance.now() - evolveStart;
    const [pa,pb] = pendingEvolution.parents;
    const hpPct = player ? Math.max(0, player.hp/player.maxHp) : 0;
    const waveBonus = 40 + Math.round(hpPct*30) + (reason.includes('todos os inimigos') ? 40 : 0);
    score += waveBonus;
    metricsLog.push({
      scenario:activeConfig?.scenario || 'LIVRE', generation,
      population:activeConfig?.population || populationSize,
      crossover:activeConfig?.crossover || Math.round(crossoverRate*100),
      mutation:activeConfig?.mutation || Math.round(mutationRate*100),
      duration:activeConfig?.duration || generationTime,
      best:best.fitness, avg, diversity, evolutionMs
    });

    ui.generationSummaryTitle.textContent = `Geração ${generation} concluída`;
    ui.generationSummaryText.textContent = `Fim da rodada: ${reason}. Bônus da missão: +${waveBonus} créditos. Os melhores inimigos já geraram a próxima população.`;
    ui.summaryBestFitness.textContent = Math.round(best.fitness);
    ui.summaryAverageFitness.textContent = Math.round(avg);
    ui.summaryMutation.textContent = `${Math.round(mutationRate*100)}%`;
    ui.parentAName.textContent = pa.name;
    ui.parentAFitness.textContent = `fitness ${Math.round(pa.fitness)}`;
    ui.parentBName.textContent = pb.name;
    ui.parentBFitness.textContent = `fitness ${Math.round(pb.fitness)}`;
    ui.offspringText.textContent = `${populationSize} naves`;
    ui.nextGenerationBtn.disabled = false;
    renderShop();
    renderLabReadout();
    ui.generationOverlay.classList.add('show');
    ui.statusText.textContent='Aguardando evolução';
    addLog(`<strong>G${generation}</strong> — melhor nave ${best.name} | fitness ${Math.round(best.fitness)} | média ${Math.round(avg)}.`);
    renderGenes(best.genome);
    drawFitnessChart();
  }

  function evolveAndContinue() {
    if (!pendingEvolution) return;
    genomes = pendingEvolution.population.map(G.copyGenome);
    pendingEvolution=null;
    generation++;
    ui.generationValue.textContent=generation;
    beginGeneration();
  }

  function shootPlayer() {
    if (playerFireCooldown>0 || state!=='playing') return;
    const base = Math.atan2(mouse.y-player.y,mouse.x-player.x);
    const bulletSpeed = 650 + playerBuild.bulletSpeed * 90;
    const damage = 24 * (1 + playerBuild.damage * .18);
    const count = 1 + playerBuild.multishot;
    const spread = count===1 ? 0 : .085;
    for (let i=0;i<count;i++) {
      const offset = (i-(count-1)/2)*spread;
      const a=base+offset;
      playerBullets.push({x:player.x+Math.cos(a)*22,y:player.y+Math.sin(a)*22,vx:Math.cos(a)*bulletSpeed,vy:Math.sin(a)*bulletSpeed,radius:4+playerBuild.bulletSpeed*.35,life:1.45,damage});
    }
    playerFireCooldown=.16/(1+playerBuild.fireRate*.16);
    createMuzzle(player.x+Math.cos(base)*20,player.y+Math.sin(base)*20,'#ffd04f');
  }

  function enemyShoot(e) {
    const g=e.genome;
    const angleToPlayer=Math.atan2(player.y-e.y,player.x-e.x);
    const acc=G.normalized('accuracy',g.accuracy);
    const aggr=G.normalized('aggression',g.aggression);
    const spread=(1-acc)*1.15 + 0.015;
    const angle=angleToPlayer+rand(-spread,spread);
    const speed=230+acc*170+aggr*70;
    const bulletRadius=3.2+G.normalized('size',g.size)*2.8;
    enemyBullets.push({x:e.x+Math.cos(angle)*(e.radius+6),y:e.y+Math.sin(angle)*(e.radius+6),vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,radius:bulletRadius,life:3.2,damage:4+aggr*9,owner:e,color:e.phenotype});
    e.shots++;
    createMuzzle(e.x+Math.cos(angle)*(e.radius+4),e.y+Math.sin(angle)*(e.radius+4),'#ff6682');
  }

  function createMuzzle(x,y,color){for(let i=0;i<5;i++)particles.push({x,y,vx:rand(-70,70),vy:rand(-70,70),life:rand(.12,.28),maxLife:.28,size:rand(1,3),color});}
  function explode(x,y,color,count=18){for(let i=0;i<count;i++)particles.push({x,y,vx:rand(-160,160),vy:rand(-160,160),life:rand(.3,.9),maxLife:.9,size:rand(1.5,4),color});}

  function update(dt) {
    if (state!=='playing' || paused) return;
    generationRemaining-=dt;
    if (generationRemaining<=0) { generationRemaining=0; endGeneration('tempo encerrado'); return; }

    updatePlayer(dt);
    updateEnemies(dt);
    updateBullets(dt);
    updateParticles(dt);

    const alive=enemies.filter(e=>e.alive).length;
    if (alive===0) { endGeneration('todos os inimigos destruídos'); return; }
    if (player.hp<=0) {
      player.hp=player.maxHp;
      player.x=W/2;player.y=H*.72;player.vx=player.vy=0;player.invuln=1.8;
      score=Math.max(0,score-40);
      addLog(`<strong>G${generation}</strong> — jogador abatido; simulação continua para avaliar a população.`);
    }
    syncHud();
  }

  function updatePlayer(dt) {
    const speedBoost=1+playerBuild.speed*.12;
    const accel=((keys.has('ShiftLeft')||keys.has('ShiftRight'))?720:460)*speedBoost;
    let ax=0,ay=0;
    if(keys.has('KeyW'))ay-=1;if(keys.has('KeyS'))ay+=1;if(keys.has('KeyA'))ax-=1;if(keys.has('KeyD'))ax+=1;
    const mag=Math.hypot(ax,ay)||1;ax/=mag;ay/=mag;
    player.vx += ax*accel*dt; player.vy += ay*accel*dt;
    const drag=Math.pow(.0018,dt);player.vx*=drag;player.vy*=drag;
    const maxSpeed=((keys.has('ShiftLeft')||keys.has('ShiftRight'))?390:285)*speedBoost;
    const sp=Math.hypot(player.vx,player.vy);if(sp>maxSpeed){player.vx=player.vx/sp*maxSpeed;player.vy=player.vy/sp*maxSpeed;}
    player.x=clamp(player.x+player.vx*dt,24,W-24);player.y=clamp(player.y+player.vy*dt,24,H-24);
    player.angle=Math.atan2(mouse.y-player.y,mouse.x-player.x);
    if(mouse.down)shootPlayer();
    playerFireCooldown=Math.max(0,playerFireCooldown-dt);player.invuln=Math.max(0,player.invuln-dt);
  }

  function updateEnemies(dt) {
    for (const e of enemies) {
      if(!e.alive)continue;
      e.age+=dt;e.survival=e.age;e.hitFlash=Math.max(0,e.hitFlash-dt);
      const g=e.genome;
      const dx=player.x-e.x,dy=player.y-e.y,d=Math.max(1,Math.hypot(dx,dy));
      const nx=dx/d,ny=dy/d;
      const speedN=G.normalized('speed',g.speed);
      const aggrN=G.normalized('aggression',g.aggression);
      const strafeN=G.normalized('strafe',g.strafe);
      const evadeN=G.normalized('evade',g.evade);
      const desiredDist=lerp(470,95,aggrN);
      const radial=d>desiredDist?1:(d<desiredDist*.62?-1:-.18);
      const perpX=-ny,perpY=nx;
      const strafeWave=Math.sin(e.age*(1.0+strafeN*5.8)+e.strafePhase);
      const strafeForce=strafeWave*strafeN*1.65;
      let tvx=(nx*radial+perpX*strafeForce)*g.speed;
      let tvy=(ny*radial+perpY*strafeForce)*g.speed;

      e.evadeCooldown-=dt;
      e.evadeBurst=Math.max(0,e.evadeBurst-dt);
      if(evadeN>.08 && e.evadeCooldown<=0){
        let threat=null,td=Infinity;
        for(const b of playerBullets){const bd=Math.hypot(b.x-e.x,b.y-e.y);if(bd<td){td=bd;threat=b;}}
        const triggerDist=85+evadeN*180;
        if(threat&&td<triggerDist){
          const bx=threat.vx,by=threat.vy,bm=Math.hypot(bx,by)||1;
          const side=Math.random()<.5?-1:1;
          e.vx+=(-by/bm)*side*(110+evadeN*330);
          e.vy+=( bx/bm)*side*(110+evadeN*330);
          e.evadeBurst=.18+evadeN*.18;
          e.evadeCooldown=lerp(1.35,.28,evadeN);
          explode(e.x,e.y,'#6cd2ff',4);
        }
      }
      if(e.evadeBurst>0){tvx+=e.vx*.45;tvy+=e.vy*.45;}

      const steering=2.0+speedN*4.5;
      e.vx += (tvx-e.vx)*Math.min(1,dt*steering);e.vy += (tvy-e.vy)*Math.min(1,dt*steering);
      e.trail.push({x:e.x,y:e.y,life:.24+speedN*.28});
      if(e.trail.length>10+Math.round(speedN*12))e.trail.shift();
      e.x=clamp(e.x+e.vx*dt,e.radius,W-e.radius);e.y=clamp(e.y+e.vy*dt,e.radius,H-e.radius);
      e.angle=Math.atan2(player.y-e.y,player.x-e.x);
      if(d<300)e.proximityTime+=dt;

      e.fireCooldown-=dt;
      const interval=1/g.fireRate;
      const attackRange=360+G.normalized('accuracy',g.accuracy)*330;
      if(e.fireCooldown<=0 && d<attackRange){enemyShoot(e);e.fireCooldown=interval*rand(.90,1.10);}

      if(d<e.radius+player.radius+4 && player.invuln<=0){const ram=10+G.normalized('aggression',g.aggression)*22+G.normalized('size',g.size)*10;const dealt=ram*dt*Math.max(.48,1-playerBuild.shield*.08);player.hp-=dealt;e.damage+=dealt;}
    }
  }

  function updateBullets(dt) {
    for(const b of playerBullets){b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;}
    for(const b of enemyBullets){b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;}

    for(const b of playerBullets){
      if(b.life<=0)continue;
      for(const e of enemies){
        if(!e.alive)continue;
        if(Math.hypot(b.x-e.x,b.y-e.y)<b.radius+e.radius){
          b.life=0;e.hp-=b.damage;e.hitFlash=.08;
          if(e.hp<=0){e.alive=false;score+=25;explode(e.x,e.y,'#ff6782',22);}else{score+=1;explode(b.x,b.y,'#8fdfff',5);}
          break;
        }
      }
    }

    for(const b of enemyBullets){
      if(b.life<=0||player.invuln>0)continue;
      if(Math.hypot(b.x-player.x,b.y-player.y)<b.radius+player.radius){
        b.life=0;const dealt=b.damage*Math.max(.48,1-playerBuild.shield*.08);player.hp-=dealt;b.owner.hits++;b.owner.damage+=dealt;explode(b.x,b.y,'#ff8da0',6);
      }
    }

    playerBullets=playerBullets.filter(b=>b.life>0&&b.x>-20&&b.x<W+20&&b.y>-20&&b.y<H+20);
    enemyBullets=enemyBullets.filter(b=>b.life>0&&b.x>-20&&b.x<W+20&&b.y>-20&&b.y<H+20);
  }

  function updateParticles(dt){for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.97;p.vy*=.97;p.life-=dt;}particles=particles.filter(p=>p.life>0);}

  function render() {
    ctx.clearRect(0,0,W,H);
    drawBackground();
    drawArena();
    drawBullets();
    drawEnemies();
    drawPlayer();
    drawParticles();
  }

  function drawBackground() {
    const grad=ctx.createLinearGradient(0,0,0,H);grad.addColorStop(0,'#141c48');grad.addColorStop(.55,'#0f1538');grad.addColorStop(1,'#080c20');ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);
    for(const s of stars){s.tw+=.012;s.y+=s.z*.14;if(s.y>H){s.y=0;s.x=Math.random()*W;}ctx.globalAlpha=.45+s.z*.35+Math.sin(s.tw)*.05;ctx.fillStyle='#fff6d6';ctx.fillRect(Math.round(s.x),Math.round(s.y),Math.max(1,Math.round(s.z*2)),Math.max(1,Math.round(s.z*2)));}ctx.globalAlpha=1;
  }

  function drawArena(){ctx.strokeStyle='rgba(255,208,79,.12)';ctx.lineWidth=1;for(let x=80;x<W;x+=80){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}for(let y=80;y<H;y+=80){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}}

  function drawPlayer() {
    if(!player)return;
    const wing=15+playerBuild.speed*1.8+playerBuild.hp*.7;
    const nose=23+playerBuild.damage*1.1;
    ctx.save();ctx.translate(player.x,player.y);ctx.rotate(player.angle+Math.PI/2);if(player.invuln>0&&Math.floor(player.invuln*12)%2===0)ctx.globalAlpha=.35;
    ctx.fillStyle='#2e7df0';ctx.beginPath();ctx.moveTo(0,-nose);ctx.lineTo(wing,17);ctx.lineTo(7,12);ctx.lineTo(0,9);ctx.lineTo(-7,12);ctx.lineTo(-wing,17);ctx.closePath();ctx.fill();
    ctx.fillStyle='#f4f5ff';ctx.beginPath();ctx.moveTo(0,-13);ctx.lineTo(6,5);ctx.lineTo(-6,5);ctx.closePath();ctx.fill();
    ctx.fillStyle='#e5433d';ctx.fillRect(-wing+1,6,(wing-3)*2,5);
    const guns=1+playerBuild.multishot;ctx.fillStyle='#ffd04f';
    if(guns>=2){ctx.fillRect(-wing+2,-3,5,14);ctx.fillRect(wing-7,-3,5,14);}else{ctx.fillRect(-2,-14,4,10);}
    if(guns>=3)ctx.fillRect(-2,-18,4,13);
    if(playerBuild.shield>0){ctx.strokeStyle=`rgba(108,210,255,${.16+playerBuild.shield*.055})`;ctx.lineWidth=2+playerBuild.shield*.35;ctx.beginPath();ctx.arc(0,0,28+playerBuild.shield*2,0,Math.PI*2);ctx.stroke();}
    ctx.fillStyle=playerBuild.bulletSpeed>=3?'#6cd2ff':'#ffd04f';ctx.beginPath();ctx.moveTo(-8,17);ctx.lineTo(0,31+playerBuild.speed*2+Math.random()*6);ctx.lineTo(8,17);ctx.closePath();ctx.fill();ctx.restore();
  }

  function enemyPalette(e) {
    if(e.phenotype==='CACADOR') return {body:'#e5443d',accent:'#ffd04f',trail:'#ff805f'};
    if(e.phenotype==='ATIRADOR') return {body:'#9b62e8',accent:'#ff72b9',trail:'#c58cff'};
    if(e.phenotype==='TANQUE') return {body:'#48b95f',accent:'#ffd04f',trail:'#7ee589'};
    return {body:'#3c88f2',accent:'#6cd2ff',trail:'#80d8ff'};
  }

  function drawEnemies() {
    for(const e of enemies){
      if(!e.alive)continue;
      const palette=enemyPalette(e);
      const speedN=G.normalized('speed',e.genome.speed);
      const sizeN=G.normalized('size',e.genome.size);
      const strafeN=G.normalized('strafe',e.genome.strafe);

      for(let i=0;i<e.trail.length;i++){
        const t=e.trail[i];
        const alpha=(i+1)/e.trail.length*.22*(.45+speedN);
        ctx.globalAlpha=alpha;
        ctx.fillStyle=palette.trail;
        const ts=2+speedN*5;
        ctx.fillRect(t.x-ts/2,t.y-ts/2,ts,ts);
      }
      ctx.globalAlpha=1;

      ctx.save();ctx.translate(e.x,e.y);ctx.rotate(e.angle+Math.PI/2);
      const r=e.radius;
      ctx.fillStyle=e.hitFlash>0?'#fff6d6':palette.body;
      ctx.beginPath();
      if(e.phenotype==='TANQUE'){
        ctx.moveTo(0,-r);ctx.lineTo(r*.9,-r*.15);ctx.lineTo(r*.75,r*.72);ctx.lineTo(0,r*.5);ctx.lineTo(-r*.75,r*.72);ctx.lineTo(-r*.9,-r*.15);
      }else if(e.phenotype==='ATIRADOR'){
        ctx.moveTo(0,-r*1.15);ctx.lineTo(r*.48,r*.78);ctx.lineTo(0,r*.5);ctx.lineTo(-r*.48,r*.78);
      }else if(e.phenotype==='ACROBATA'){
        ctx.moveTo(0,-r);ctx.lineTo(r*(1+strafeN*.3),r*.52);ctx.lineTo(r*.18,r*.28);ctx.lineTo(0,r*.82);ctx.lineTo(-r*.18,r*.28);ctx.lineTo(-r*(1+strafeN*.3),r*.52);
      }else{
        ctx.moveTo(0,-r);ctx.lineTo(r*.82,r*.64);ctx.lineTo(r*.24,r*.42);ctx.lineTo(0,r*.88);ctx.lineTo(-r*.24,r*.42);ctx.lineTo(-r*.82,r*.64);
      }
      ctx.closePath();ctx.fill();
      ctx.fillStyle=palette.accent;ctx.fillRect(-r*.34,-r*.16,r*.68,Math.max(4,r*.28));
      if(sizeN>.65){ctx.fillStyle='#fff6d6';ctx.fillRect(-r*.72,r*.36,r*1.44,3);}
      ctx.restore();

      const hp=Math.max(0,e.hp/e.maxHp);ctx.fillStyle='rgba(0,0,0,.55)';ctx.fillRect(e.x-e.radius,e.y+e.radius+7,e.radius*2,4);ctx.fillStyle='#42c25b';ctx.fillRect(e.x-e.radius,e.y+e.radius+7,e.radius*2*hp,4);
    }
  }

  function drawBullets(){for(const b of playerBullets){ctx.fillStyle='#ffd04f';ctx.fillRect(b.x-b.radius,b.y-b.radius,b.radius*2,b.radius*2);}for(const b of enemyBullets){const colors={CACADOR:'#ff5b43',ATIRADOR:'#ff72b9',TANQUE:'#9be051',ACROBATA:'#6cd2ff'};ctx.fillStyle=colors[b.color]||'#ff72b9';ctx.fillRect(b.x-b.radius,b.y-b.radius,b.radius*2,b.radius*2);}}
  function drawParticles(){for(const p of particles){ctx.globalAlpha=Math.max(0,p.life/p.maxLife);ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,p.size,p.size);}ctx.globalAlpha=1;}

  function syncHud() {
    ui.generationValue.textContent=generation;
    const hpPct=player?Math.max(0,player.hp/player.maxHp*100):100;
    ui.playerHpText.textContent=`${Math.round(hpPct)}%`;
    ui.playerHpBar.style.width=`${hpPct}%`;
    ui.scoreValue.textContent=score;
    ui.timerValue.textContent=generationRemaining.toFixed(1);
    const alive=enemies.filter(e=>e.alive).length;
    ui.aliveValue.textContent=alive;
    const bestLive=enemies.length?Math.max(...enemies.map(e=>calculateFitness({...e,survival:e.age}))):0;
    ui.liveBestFitness.textContent=Math.round(bestLive);
    ui.populationHud.textContent=populationSize;
    ui.crossoverHud.textContent=`${Math.round(crossoverRate*100)}%`;
    ui.mutationHud.textContent=`${Math.round(mutationRate*100)}%`;

    const currentBest = enemies.length ? [...enemies].sort((a,b)=>calculateFitness(b)-calculateFitness(a))[0] : null;
    if(currentBest)renderGenes(currentBest.genome);
  }

  function renderGenes(genome) {
    if(!genome)return;
    ui.championBadge.textContent=`G${generation} · ${G.phenotype(genome)}`;
    ui.geneBars.innerHTML='';
    for(const [name,def] of Object.entries(G.GENE_DEFS)){
      const n=G.normalized(name,genome[name]);
      const row=document.createElement('div');row.className='gene-row';
      row.innerHTML=`<span>${def.label}</span><div class="gene-track"><i style="width:${Math.round(n*100)}%"></i></div><strong>${Math.round(n*100)}</strong>`;
      ui.geneBars.appendChild(row);
    }
  }

  function drawFitnessChart() {
    const c=ui.fitnessChart,cx=c.getContext('2d'),w=c.width,h=c.height,m={l:34,r:12,t:16,b:27};cx.clearRect(0,0,w,h);cx.fillStyle='#0b1029';cx.fillRect(0,0,w,h);cx.strokeStyle='#2d3b7c';cx.lineWidth=1;for(let i=0;i<4;i++){const y=m.t+(h-m.t-m.b)/3*i;cx.beginPath();cx.moveTo(m.l,y);cx.lineTo(w-m.r,y);cx.stroke();}
    if(!history.length){cx.fillStyle='#d9d0aa';cx.font='12px monospace';cx.fillText('Sem dados de gerações ainda.',m.l+10,h/2);return;}
    const max=Math.max(100,...history.map(d=>d.best))*1.08,pw=w-m.l-m.r,ph=h-m.t-m.b,den=Math.max(1,history.length-1);
    const draw=(field,color)=>{cx.strokeStyle=color;cx.lineWidth=2.5;cx.beginPath();history.forEach((d,i)=>{const x=m.l+i/den*pw,y=m.t+ph-d[field]/max*ph;i?cx.lineTo(x,y):cx.moveTo(x,y)});cx.stroke();};
    draw('best','#ffd04f');draw('avg','#ff72b9');cx.fillStyle='#d9d0aa';cx.font='10px monospace';history.forEach((d,i)=>{if(history.length<8||i%2===0)cx.fillText(`G${d.generation}`,m.l+i/den*pw-6,h-8);});
  }

  function addLog(html){const div=document.createElement('div');div.className='log-entry';div.innerHTML=html;ui.evolutionLog.prepend(div);while(ui.evolutionLog.children.length>10)ui.evolutionLog.lastChild.remove();}

  function frame(ts) {
    const dt=Math.min(.033,(ts-lastTs)/1000||0);lastTs=ts;update(dt);render();raf=requestAnimationFrame(frame);
  }

  function canvasMousePos(ev){const rect=canvas.getBoundingClientRect();return{x:(ev.clientX-rect.left)/rect.width*W,y:(ev.clientY-rect.top)/rect.height*H};}

  function resetAll(){cancelAnimationFrame(raf);generation=1;history=[];genomes=[];pendingEvolution=null;metricsLog=[];selectedScenario='LIVRE';activeConfig=null;playerBuild={hp:0,speed:0,damage:0,fireRate:0,bulletSpeed:0,multishot:0,shield:0};enemies=[];state='menu';score=0;prepareInitialPopulation();resetPlayer();generationRemaining=Number(ui.durationInput.value);ui.generationValue.textContent='1';ui.startOverlay.classList.add('show');ui.generationOverlay.classList.remove('show');ui.statusText.textContent='Aguardando início';ui.evolutionLog.innerHTML='';addLog('<strong>G1</strong> — primeira população criada.');renderGenes(genomes[0]);drawFitnessChart();renderLabReadout();syncHud();lastTs=0;raf=requestAnimationFrame(frame);}

  function syncRangeOutputs() {
    ui.populationOut.textContent=ui.populationInput.value;
    ui.crossoverOut.textContent=`${ui.crossoverInput.value}%`;
    ui.mutationOut.textContent=`${ui.mutationInput.value}%`;
    ui.durationOut.textContent=`${ui.durationInput.value}s`;
  }

  function bind(){
    window.addEventListener('keydown',e=>{if(['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight'].includes(e.code))keys.add(e.code);if(e.code==='Space'){e.preventDefault();mouse.down=true;}});
    window.addEventListener('keyup',e=>{keys.delete(e.code);if(e.code==='Space')mouse.down=false;});
    canvas.addEventListener('mousemove',e=>Object.assign(mouse,canvasMousePos(e)));canvas.addEventListener('mousedown',e=>{if(e.button===0){Object.assign(mouse,canvasMousePos(e));mouse.down=true;}});window.addEventListener('mouseup',()=>mouse.down=false);

    ui.startBtn.addEventListener('click',beginGeneration);ui.nextGenerationBtn.addEventListener('click',evolveAndContinue);
    ui.pauseBtn.addEventListener('click',()=>{if(state!=='playing')return;paused=!paused;ui.pauseBtn.textContent=paused?'Continuar':'Pausar';ui.statusText.textContent=paused?'Pausado':'Combate em andamento';});
    ui.resetBtn.addEventListener('click',()=>{if(confirm('Reiniciar toda a simulação evolutiva?'))resetAll();});
    ui.scenarioABtn.addEventListener('click',()=>setScenario('A'));
    ui.scenarioBBtn.addEventListener('click',()=>setScenario('B'));
    ui.exportMetricsBtn.addEventListener('click',exportMetrics);
    
    const fields=[
      [ui.populationInput,ui.populationOut,v=>v],
      [ui.crossoverInput,ui.crossoverOut,v=>`${v}%`],
      [ui.mutationInput,ui.mutationOut,v=>`${v}%`],
      [ui.durationInput,ui.durationOut,v=>`${v}s`]
    ];
    fields.forEach(([input,out,fmt])=>{const sync=()=>out.textContent=fmt(input.value);input.addEventListener('input',sync);sync();});
  }

  createStars();prepareInitialPopulation();resetPlayer();bind();renderPlayerStats();renderLabReadout();addLog('<strong>G1</strong> — primeira população criada.');renderGenes(genomes[0]);drawFitnessChart();syncHud();raf=requestAnimationFrame(frame);
})();
