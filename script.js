// ===== Dog Run =====
// The game world is a fixed 1920x864 stage that is scaled to fit the window,
// so the dog, bombs and floor line up on every screen size.

// ----- World settings -----
const STAGE_W = 1920;
const STAGE_H = 864;
const GROUND = 800;              // y position of the floor (where feet touch)

const DOG_H = 230;
const DOG_W = DOG_H * 547 / 481; // sprite images are 547x481
const DOG_MIN_X = 40;
const DOG_MAX_X = 1100;
const DOG_MOVE_SPEED = 450;      // px per second when using left / right

const GRAVITY = 3200;
const FAST_FALL_GRAVITY = 7000;  // extra pull while holding down in the air
const JUMP_SPEED = 1350;
const DOUBLE_JUMP_SPEED = 1150;

const BOX_W = 240;
const BOX_H = 180;
const TOTAL_BOMBS = 20;          // get past this many to win
const START_SPEED = 650;
const MAX_SPEED = 1250;
const SPEED_PER_BOMB = 28;

// ----- Elements -----
const stage = document.getElementById("stage");
const background = document.getElementById("background");
const obstacleLayer = document.getElementById("obstacles");
const dog = document.getElementById("dog");
const scoreEl = document.getElementById("score");
const bombsEl = document.getElementById("bombs");
const bestEl = document.getElementById("best");
const levelEl = document.getElementById("level");
const muteBtn = document.getElementById("muteBtn");
const pauseBtn = document.getElementById("pauseBtn");
const screens = {
    start: document.getElementById("start"),
    pause: document.getElementById("pause"),
    end: document.getElementById("end"),
    win: document.getElementById("win"),
};

dog.style.width = DOG_W + "px";

// ----- Sprites -----
const ANIMATIONS = { Idle: 10, Run: 8, Jump: 8, Slide: 10, Dead: 10 };
const preloaded = [];

function spritePath(name, frame) {
    return "resources/" + name + " (" + frame + ").png";
}

// Load every frame up front so the dog never flickers while frames download
for (const name in ANIMATIONS) {
    for (let i = 1; i <= ANIMATIONS[name]; i++) {
        const img = new Image();
        img.src = spritePath(name, i);
        preloaded.push(img);
    }
}

let currentSprite = "";
function setSprite(name, frame) {
    const path = spritePath(name, frame);
    if (path !== currentSprite) {
        dog.src = path;
        currentSprite = path;
    }
}

// ----- Sound -----
let muted = false;

function playSound(id) {
    if (muted) return;
    const sound = document.getElementById(id);
    sound.currentTime = 0;
    const promise = sound.play();
    if (promise) promise.catch(function () {}); // browser may block audio; ignore
}

function stopSounds() {
    document.querySelectorAll("audio").forEach(function (a) {
        a.pause();
        a.currentTime = 0;
    });
}

function toggleMute() {
    muted = !muted;
    document.querySelectorAll("audio").forEach(function (a) { a.muted = muted; });
    muteBtn.textContent = muted ? "🔇" : "🔊";
}

// ----- Best score (saved in the browser) -----
function loadBest() {
    try { return parseInt(localStorage.getItem("dogRunBest"), 10) || 0; }
    catch (e) { return 0; }
}

function saveBest(value) {
    try { localStorage.setItem("dogRunBest", String(value)); }
    catch (e) { /* storage unavailable, keep it for this session only */ }
}

let best = loadBest();

// ----- Game state -----
// "ready" -> "running" <-> "paused" -> "dying" -> "over"  (or "won")
let state = "ready";
let dogX, dogFeetY, dogVY, onGround, jumpsLeft, sliding;
let speed, distance, score, bombsSpawned, bombsPassed, nextGap, sinceLastSpawn;
let bgX, animTime, deadTime;
let bombs = [];

const input = { left: false, right: false, down: false };

function resetGame() {
    bombs.forEach(function (b) { b.el.remove(); });
    bombs = [];

    dogX = 200;
    dogFeetY = GROUND;
    dogVY = 0;
    onGround = true;
    jumpsLeft = 1;
    sliding = false;

    speed = START_SPEED;
    distance = 0;
    score = 0;
    bombsSpawned = 0;
    bombsPassed = 0;
    sinceLastSpawn = 0;
    nextGap = 900;
    bgX = 0;
    animTime = 0;
    deadTime = 0;

    input.left = input.right = input.down = false;
    updateHud();
    render();
}

function showScreen(name) {
    for (const key in screens) {
        screens[key].classList.toggle("visible", key === name);
    }
}

function startGame() {
    resetGame();
    stopSounds();
    state = "running";
    showScreen(null);
}

function togglePause() {
    if (state === "running") {
        state = "paused";
        showScreen("pause");
        pauseBtn.textContent = "▶";
    } else if (state === "paused") {
        state = "running";
        showScreen(null);
        pauseBtn.textContent = "⏸";
        lastTime = performance.now();
    }
}

function jump() {
    if (state !== "running") return;
    if (onGround) {
        dogVY = -JUMP_SPEED;
        onGround = false;
        jumpsLeft = 1;
        playSound("jumpSound");
    } else if (jumpsLeft > 0) {
        dogVY = -DOUBLE_JUMP_SPEED;
        jumpsLeft = 0;
        playSound("jumpSound");
    }
}

function endGame() {
    state = "dying";
    deadTime = 0;
    animTime = 0;
    playSound("endSound");
}

function winGame() {
    state = "won";
    playSound("winSound");
    finishScore();
    document.getElementById("winscore").textContent = score;
    showScreen("win");
}

function finishScore() {
    const isNewBest = score > best;
    if (isNewBest) {
        best = score;
        saveBest(best);
    }
    const text = isNewBest ? "New best score!" : "Best: " + best;
    document.getElementById("endbest").textContent = text;
    document.getElementById("winbest").textContent = text;
    updateHud();
}

// ----- Bombs -----
function spawnBomb() {
    // After the first few bombs, some fly at head height: slide under or jump over them
    const flying = bombsSpawned >= 4 && Math.random() < 0.35;
    const el = document.createElement("div");
    el.className = flying ? "box flying" : "box";
    obstacleLayer.appendChild(el);

    bombs.push({
        el: el,
        x: STAGE_W + 40,
        top: flying ? GROUND - 257 : GROUND - 136,
        flying: flying,
        bob: Math.random() * Math.PI * 2,
        passed: false,
    });

    bombsSpawned++;
    sinceLastSpawn = 0;
    // Leave enough room to react, more after a flying bomb
    const minGap = speed * (flying ? 1.25 : 1.0);
    nextGap = minGap + Math.random() * 600;
}

function bombHitbox(b) {
    const bobOffset = b.flying ? Math.sin(b.bob) * 10 : 0;
    return {
        left: b.x + 82,
        right: b.x + 160,
        top: b.top + bobOffset + 48,
        bottom: b.top + bobOffset + 130,
    };
}

function dogHitbox() {
    return {
        left: dogX + DOG_W * 0.32,
        right: dogX + DOG_W * 0.70,
        top: dogFeetY - DOG_H * (sliding ? 0.40 : 0.80),
        bottom: dogFeetY - DOG_H * 0.05,
    };
}

function overlaps(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// ----- Update -----
function update(dt) {
    if (state === "paused" || state === "over" || state === "won") return;
    animTime += dt;

    if (state === "dying") {
        // Let the dog drop to the floor while the dead animation plays
        if (!onGround) applyGravity(dt, GRAVITY);
        deadTime += dt;
        if (deadTime > 1.2) {
            state = "over";
            finishScore();
            document.getElementById("endscore").textContent = score;
            showScreen("end");
        }
        return;
    }

    if (state !== "running") return;

    // Move the world
    const move = speed * dt;
    distance += move;
    sinceLastSpawn += move;
    bgX = (bgX - move) % STAGE_W;

    // Dog left / right
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    dogX = Math.min(DOG_MAX_X, Math.max(DOG_MIN_X, dogX + dir * DOG_MOVE_SPEED * dt));

    // Jump physics (holding down in the air drops faster)
    if (!onGround) applyGravity(dt, input.down ? FAST_FALL_GRAVITY : GRAVITY);
    sliding = onGround && input.down;

    // Bombs
    if (bombsSpawned < TOTAL_BOMBS && sinceLastSpawn >= nextGap) spawnBomb();

    const dogBox = dogHitbox();
    for (let i = bombs.length - 1; i >= 0; i--) {
        const b = bombs[i];
        b.x -= move;
        b.bob += dt * 5;
        const box = bombHitbox(b);

        if (overlaps(dogBox, box)) {
            endGame();
            return;
        }

        if (!b.passed && box.right < dogBox.left) {
            b.passed = true;
            bombsPassed++;
            score += 50;
            speed = Math.min(MAX_SPEED, speed + SPEED_PER_BOMB);
        }

        if (b.x < -BOX_W - 40) {
            b.el.remove();
            bombs.splice(i, 1);
        }
    }

    score = Math.floor(distance / 10) + bombsPassed * 50;
    updateHud();

    if (bombsPassed >= TOTAL_BOMBS) winGame();
}

function applyGravity(dt, gravity) {
    dogVY += gravity * dt;
    dogFeetY += dogVY * dt;
    if (dogFeetY >= GROUND) {
        dogFeetY = GROUND;
        dogVY = 0;
        onGround = true;
        jumpsLeft = 1;
    }
}

function updateHud() {
    scoreEl.textContent = "Score " + score;
    bombsEl.textContent = "Bombs " + bombsPassed + "/" + TOTAL_BOMBS;
    bestEl.textContent = "Best " + Math.max(best, score);
    levelEl.textContent = "Speed " + (1 + Math.floor(bombsPassed / 4));
}

// ----- Draw -----
function render() {
    background.style.backgroundPositionX = bgX + "px";
    dog.style.transform = "translate(" + dogX + "px," + (dogFeetY - DOG_H + 9) + "px)";

    bombs.forEach(function (b) {
        const bobOffset = b.flying ? Math.sin(b.bob) * 10 : 0;
        b.el.style.transform = "translate(" + b.x + "px," + (b.top + bobOffset) + "px)";
    });

    if (state === "dying" || state === "over") {
        setSprite("Dead", Math.min(10, 1 + Math.floor(animTime * 12)));
    } else if (state === "ready") {
        setSprite("Idle", 1 + Math.floor(animTime * 12) % 10);
    } else if (!onGround) {
        // Pick the jump frame from the vertical speed: rising 1-4, top 5, falling 6-8
        const t = (dogVY + JUMP_SPEED) / (2 * JUMP_SPEED);
        setSprite("Jump", Math.min(8, Math.max(1, Math.round(1 + t * 7))));
    } else if (sliding) {
        setSprite("Slide", 1 + Math.floor(animTime * 20) % 10);
    } else if (state === "running" || state === "paused") {
        setSprite("Run", 1 + Math.floor(animTime * (8 + speed / 60)) % 8);
    }
}

// ----- Main loop -----
let lastTime = performance.now();

function loop(now) {
    // Clamp: first frame can be slightly negative, and cap big jumps after tab switches
    const dt = Math.max(0, Math.min((now - lastTime) / 1000, 0.05));
    lastTime = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
}

// ----- Fit the stage to the window -----
function resize() {
    const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    stage.style.transform = "translate(-50%, -50%) scale(" + scale + ")";
}

window.addEventListener("resize", resize);

// ----- Keyboard -----
const GAME_KEYS = ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

document.addEventListener("keydown", function (event) {
    if (GAME_KEYS.includes(event.code)) event.preventDefault(); // stop page scrolling

    switch (event.code) {
        case "ArrowLeft":
        case "KeyA":
            input.left = true;
            return;
        case "ArrowRight":
        case "KeyD":
            input.right = true;
            return;
        case "ArrowDown":
        case "KeyS":
            input.down = true;
            return;
    }

    if (event.repeat) return;

    switch (event.code) {
        case "Enter":
        case "NumpadEnter":
            event.preventDefault();
            if (state === "ready" || state === "over" || state === "won") startGame();
            else if (state === "paused") togglePause();
            break;
        case "Space":
        case "ArrowUp":
        case "KeyW":
            if (state === "ready") startGame();
            jump();
            break;
        case "KeyP":
        case "Escape":
            togglePause();
            break;
        case "KeyM":
            toggleMute();
            break;
        case "KeyR":
            if (state !== "ready") startGame();
            break;
    }
});

document.addEventListener("keyup", function (event) {
    switch (event.code) {
        case "ArrowLeft":
        case "KeyA":
            input.left = false;
            break;
        case "ArrowRight":
        case "KeyD":
            input.right = false;
            break;
        case "ArrowDown":
        case "KeyS":
            input.down = false;
            break;
    }
});

// Pause when the player switches tabs or windows
window.addEventListener("blur", function () {
    input.left = input.right = input.down = false;
    if (state === "running") togglePause();
});

// ----- Buttons -----
function onButton(id, handler) {
    document.getElementById(id).addEventListener("click", function (event) {
        event.currentTarget.blur(); // keep Space/Enter for the game, not the button
        handler();
    });
}

onButton("startBtn", startGame);
onButton("retryBtn", startGame);
onButton("againBtn", startGame);
onButton("resumeBtn", togglePause);
onButton("pauseBtn", togglePause);
onButton("muteBtn", toggleMute);

// ----- Touch controls -----
document.querySelectorAll(".touch-btn").forEach(function (btn) {
    const key = btn.dataset.key;

    btn.addEventListener("pointerdown", function (event) {
        event.preventDefault();
        btn.classList.add("pressed");
        if (key === "jump") {
            if (state === "ready" || state === "over" || state === "won") startGame();
            jump();
        } else {
            input[key] = true;
        }
    });

    function release() {
        btn.classList.remove("pressed");
        if (key !== "jump") input[key] = false;
    }

    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointercancel", release);
    btn.addEventListener("pointerleave", release);
});

// ----- Start -----
resetGame();
resize();
requestAnimationFrame(loop);
