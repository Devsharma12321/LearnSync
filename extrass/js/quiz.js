/* ===========================
   Quiz JS — AI Quiz Engine
   =========================== */

// ---- State ----
let state = {
  topic: null, mode: null, count: 10,
  questions: [], current: 0, score: 0,
  answers: [], startTime: null, timerInterval: null, timeLeft: 30,
  hintUsed: false,
};

// ---- Mock AI Question Bank ----
const QUESTION_BANK = {
  dsa: [
    { q:"What is the time complexity of binary search?", opts:["O(n)","O(n log n)","O(log n)","O(1)"], ans:2, exp:"Binary search halves the search space each time → O(log n)." },
    { q:"Which data structure uses LIFO order?", opts:["Queue","Stack","Tree","Heap"], ans:1, exp:"Stack follows Last-In First-Out (LIFO)." },
    { q:"What is the worst-case complexity of QuickSort?", opts:["O(n log n)","O(n)","O(n²)","O(log n)"], ans:2, exp:"QuickSort worst-case is O(n²) when pivot is always min/max element." },
    { q:"Which traversal visits Left → Root → Right?", opts:["Pre-order","Post-order","In-order","Level-order"], ans:2, exp:"In-order traversal: Left → Root → Right." },
    { q:"What is the space complexity of Merge Sort?", opts:["O(1)","O(log n)","O(n)","O(n²)"], ans:2, exp:"Merge sort requires O(n) auxiliary space for merging." },
    { q:"A hash table with chaining — average lookup time?", opts:["O(1)","O(n)","O(log n)","O(n²)"], ans:0, exp:"Average case O(1) assuming a good hash function and load factor." },
    { q:"Which algorithm finds shortest path in unweighted graph?", opts:["DFS","BFS","Dijkstra","Bellman-Ford"], ans:1, exp:"BFS finds shortest path (fewest edges) in unweighted graphs." },
    { q:"Insertion in a min-heap — time complexity?", opts:["O(1)","O(log n)","O(n)","O(n log n)"], ans:1, exp:"Heap insertion requires bubbling up → O(log n)." },
    { q:"Which sort is stable and in-place?", opts:["QuickSort","Merge Sort","Insertion Sort","Heap Sort"], ans:2, exp:"Insertion sort is both stable and in-place." },
    { q:"What does DFS use internally?", opts:["Queue","Stack","Heap","Array"], ans:1, exp:"DFS uses a stack (explicit or via recursion call stack)." },
  ],
  webdev: [
    { q:"What does CSS `position: sticky` do?", opts:["Fixes element to viewport","Sticks element relative to scroll within parent","Same as fixed","Same as relative"], ans:1, exp:"sticky sticks element within its scrolling parent container." },
    { q:"Which HTTP method is idempotent but NOT safe?", opts:["GET","POST","PUT","DELETE"], ans:2, exp:"PUT is idempotent (same result each call) but not safe (modifies data)." },
    { q:"What is the virtual DOM used for?", opts:["Storing data server-side","Speeding up real DOM updates by diffing","CSS rendering","HTTP caching"], ans:1, exp:"Virtual DOM diffs changes before applying minimal updates to real DOM." },
    { q:"Which CSS selector has the highest specificity?", opts:["Element","Class","ID","Inline style"], ans:3, exp:"Inline styles have the highest specificity (1000)." },
    { q:"What does CORS stand for?", opts:["Cross-Origin Resource Sharing","Cross-Order Request System","Client-Origin Resource Sharing","Content-Origin Routing System"], ans:0, exp:"Cross-Origin Resource Sharing controls cross-domain HTTP requests." },
    { q:"Which JS method creates a shallow copy of an array?", opts:["arr.clone()","[...arr]","arr.deepCopy()","arr.copy()"], ans:1, exp:"Spread operator [...arr] creates a shallow copy." },
    { q:"What is the default value of `display` for a `<div>`?", opts:["inline","block","flex","none"], ans:1, exp:"<div> is a block-level element by default." },
    { q:"What does `async/await` wrap a function's return in?", opts:["Callback","Observable","Promise","Event"], ans:2, exp:"async functions always return a Promise." },
    { q:"Which HTTP status code means 'Unauthorized'?", opts:["403","404","401","500"], ans:2, exp:"401 Unauthorized means authentication is required." },
    { q:"What is tree-shaking in bundlers?", opts:["Removing dead code","Optimizing CSS","Splitting bundles","Compressing images"], ans:0, exp:"Tree-shaking eliminates unused exports from the final bundle." },
  ],
  os: [
    { q:"What is a deadlock?", opts:["Process waiting infinitely for resources","CPU overload","Memory leak","Cache miss"], ans:0, exp:"Deadlock: circular wait where processes block each other indefinitely." },
    { q:"Which scheduling algorithm can cause starvation?", opts:["Round Robin","FCFS","Priority Scheduling","Multilevel Queue"], ans:2, exp:"Priority Scheduling can starve low-priority processes." },
    { q:"What is thrashing in OS?", opts:["High CPU usage","Excessive paging causing low throughput","Disk fragmentation","Cache overflow"], ans:1, exp:"Thrashing occurs when system spends more time swapping pages than executing." },
    { q:"What does a semaphore do?", opts:["Allocates memory","Controls access to shared resources","Schedules processes","Manages I/O"], ans:1, exp:"Semaphores are synchronization primitives for shared resource access." },
    { q:"Virtual memory allows…", opts:["Faster CPU","Programs larger than physical RAM","Disk caching","Network sharing"], ans:1, exp:"Virtual memory lets programs use address space larger than physical RAM." },
  ],
  dbms: [
    { q:"What does ACID stand for?", opts:["Atomicity, Consistency, Isolation, Durability","Access, Control, Integrity, Data","Atomic, Cached, Indexed, Durable","None of above"], ans:0, exp:"ACID properties ensure reliable database transactions." },
    { q:"Which normal form eliminates transitive dependencies?", opts:["1NF","2NF","3NF","BCNF"], ans:2, exp:"3NF removes transitive functional dependencies." },
    { q:"What is a foreign key?", opts:["Primary key of same table","Key referencing primary key of another table","Unique non-null key","Composite key"], ans:1, exp:"Foreign key references the primary key of another table to maintain referential integrity." },
    { q:"Which JOIN returns all rows from both tables?", opts:["INNER JOIN","LEFT JOIN","RIGHT JOIN","FULL OUTER JOIN"], ans:3, exp:"FULL OUTER JOIN returns all rows from both tables, with NULLs for unmatched." },
    { q:"What is an index used for in databases?", opts:["Storing data","Speeding up data retrieval","Enforcing constraints","Normalizing tables"], ans:1, exp:"Indexes speed up SELECT queries at the cost of slower writes." },
  ],
  cn: [
    { q:"What layer does TCP operate at?", opts:["Physical","Data Link","Network","Transport"], ans:3, exp:"TCP is a Transport layer (Layer 4) protocol." },
    { q:"What is the purpose of ARP?", opts:["Assign IP addresses","Map IP to MAC address","Route packets","Encrypt traffic"], ans:1, exp:"ARP (Address Resolution Protocol) maps IP addresses to MAC addresses." },
    { q:"Which protocol uses port 443?", opts:["HTTP","FTP","HTTPS","SSH"], ans:2, exp:"HTTPS uses port 443 for secure web traffic." },
    { q:"What is subnetting?", opts:["Splitting a network into smaller subnetworks","Connecting multiple LANs","DNS resolution","IP assignment"], ans:0, exp:"Subnetting divides a network into smaller, manageable subnetworks." },
    { q:"CIDR notation /24 means?", opts:["24 hosts","24-bit network prefix","Class C only","24 subnets"], ans:1, exp:"/24 means the first 24 bits are the network prefix, leaving 8 bits for hosts." },
  ],
  ml: [
    { q:"What is overfitting?", opts:["Model underfits training data","Model memorizes training data and fails on new data","Model has too few parameters","Model has high bias"], ans:1, exp:"Overfitting: model memorizes training data, poor generalization." },
    { q:"Which algorithm minimizes a loss function using gradients?", opts:["K-means","Gradient Descent","Decision Tree","SVM"], ans:1, exp:"Gradient Descent iteratively updates weights to minimize loss." },
    { q:"Bias-variance tradeoff: high bias means?", opts:["Overfitting","Underfitting","Good generalization","High complexity"], ans:1, exp:"High bias → underfitting → model too simple to capture patterns." },
    { q:"What does 'epoch' mean in ML?", opts:["One forward pass","One pass through entire training dataset","One batch","One weight update"], ans:1, exp:"An epoch is one complete pass through the entire training dataset." },
    { q:"Which activation function outputs 0 or 1 only?", opts:["ReLU","Sigmoid","Step function","Tanh"], ans:2, exp:"Step function outputs binary 0 or 1 based on threshold." },
  ],
  math: [
    { q:"What is the derivative of sin(x)?", opts:["cos(x)","-cos(x)","tan(x)","-sin(x)"], ans:0, exp:"d/dx[sin(x)] = cos(x)." },
    { q:"What is P(A∪B) if A and B are independent?", opts:["P(A)+P(B)","P(A)+P(B)-P(A)P(B)","P(A)P(B)","P(A)-P(B)"], ans:1, exp:"P(A∪B) = P(A) + P(B) - P(A∩B) = P(A)+P(B)-P(A)P(B) for independent events." },
    { q:"What is the Big-O of T(n) = 2T(n/2) + n?", opts:["O(n)","O(n log n)","O(n²)","O(log n)"], ans:1, exp:"By Master Theorem case 2, T(n) = O(n log n)." },
    { q:"Eigenvalue of a matrix A if Av = λv, v≠0 is?", opts:["Determinant","Trace","λ","Rank"], ans:2, exp:"λ is the eigenvalue corresponding to eigenvector v." },
    { q:"What is the Bayes theorem formula?", opts:["P(A|B)=P(B|A)P(A)/P(B)","P(A|B)=P(A)P(B)","P(A∪B)=P(A)+P(B)","None"], ans:0, exp:"Bayes: P(A|B) = P(B|A)·P(A) / P(B)." },
  ],
  system: [
    { q:"What is horizontal scaling?", opts:["Upgrading single server","Adding more servers","Optimizing DB queries","Using CDN"], ans:1, exp:"Horizontal scaling (scale out): adding more machines to distribute load." },
    { q:"What is the CAP theorem?", opts:["Consistency, Availability, Partition tolerance — pick 2","Cache, API, Protocol","Compute, Access, Performance","None"], ans:0, exp:"CAP: in presence of network partition, choose between Consistency and Availability." },
    { q:"What does a load balancer do?", opts:["Stores data","Distributes traffic across servers","Encrypts requests","Caches responses"], ans:1, exp:"Load balancer distributes incoming requests across multiple backend servers." },
    { q:"What is eventual consistency?", opts:["Data always consistent","Data consistent after some delay","Immediate consistency","No consistency"], ans:1, exp:"Eventual consistency: system converges to consistent state given enough time with no updates." },
    { q:"What is sharding in databases?", opts:["Indexing rows","Partitioning data across multiple databases","Replicating databases","Caching queries"], ans:1, exp:"Sharding splits data horizontally across multiple database instances." },
  ],
};

// ---- Fallback mock for text mode feedback ----
const TEXT_FEEDBACK = [
  { score:9, text:"Excellent! Your answer covers all key points accurately. Great depth of understanding!" },
  { score:7, text:"Good answer! You got the main concept right. You could also mention the edge cases for a perfect score." },
  { score:5, text:"Partially correct. You understand the basics but missed some important details." },
  { score:3, text:"Your answer shows some understanding but lacks precision. Review the concept again." },
];

// ---- Hints ----
const HINTS = {
  dsa:"Think about how the problem can be broken into sub-problems. Consider the data structures that give O(1) or O(log n) access.",
  webdev:"Think about the browser rendering pipeline and how JavaScript interacts with the DOM.",
  os:"Consider process synchronization and how the OS manages shared resources.",
  dbms:"Think about data relationships and how to maintain consistency across tables.",
  cn:"Think about the OSI model layers and which layer handles this functionality.",
  ml:"Think about the bias-variance tradeoff and how the model learns from data.",
  math:"Think about the fundamental theorem or property that applies here.",
  system:"Consider the CAP theorem and scalability trade-offs.",
};

// ---- Screen Management ----
function showScreen(id) {
  document.querySelectorAll('.quiz-screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) { el.classList.add('active'); el.scrollIntoView({ behavior:'smooth', block:'start' }); }
}

// ---- Selection Logic ----
document.querySelectorAll('.topic-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.topic-pill').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    state.topic = btn.dataset.topic;
    updateStartBtn();
  });
});

document.querySelectorAll('.mode-card').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-card').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    state.mode = btn.dataset.mode;
    updateStartBtn();
  });
});

document.querySelectorAll('.count-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.count-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.count = parseInt(btn.dataset.count);
  });
});

function updateStartBtn() {
  const btn = document.getElementById('start-quiz-btn');
  if (btn) btn.disabled = !(state.topic && state.mode);
}

// Pre-select from URL param
const urlTopic = new URLSearchParams(location.search).get('topic');
if (urlTopic) {
  const pill = document.querySelector(`[data-topic="${urlTopic}"]`);
  if (pill) pill.click();
}

// ---- Start Quiz ----
document.getElementById('start-quiz-btn')?.addEventListener('click', async () => {
  const label = document.getElementById('loading-topic-label');
  const topicName = document.querySelector(`[data-topic="${state.topic}"]`)?.textContent || state.topic;
  if (label) label.textContent = `Crafting ${state.count} ${topicName} questions for you…`;

  showScreen('screen-loading');
  await generateQuestions();
  startQuiz();
});

async function generateQuestions() {
  await new Promise(r => setTimeout(r, 1800)); // simulate AI delay
  const bank = QUESTION_BANK[state.topic] || QUESTION_BANK.dsa;
  const shuffled = [...bank].sort(() => Math.random() - 0.5);
  state.questions = shuffled.slice(0, Math.min(state.count, shuffled.length));
}

// ---- Quiz Engine ----
function startQuiz() {
  state.current = 0; state.score = 0; state.answers = [];
  state.startTime = Date.now();
  showScreen('screen-quiz');
  renderQuestion();
}

function renderQuestion() {
  const q = state.questions[state.current];
  if (!q) { endQuiz(); return; }

  state.hintUsed = false;
  clearTimer();

  const total = state.questions.length;
  const idx   = state.current;

  document.getElementById('q-counter').textContent   = `Q ${idx+1} / ${total}`;
  document.getElementById('q-num').textContent       = `Question ${idx+1}`;
  document.getElementById('question-text').textContent = q.q;
  document.getElementById('quiz-topic-badge').textContent = document.querySelector(`[data-topic="${state.topic}"]`)?.textContent || state.topic;
  document.getElementById('quiz-progress-bar').style.width = `${((idx+1)/total)*100}%`;

  // Reset result UI
  document.getElementById('mcq-result').style.display = 'none';
  document.getElementById('hint-box').style.display   = 'none';
  document.getElementById('next-btn').disabled         = true;

  if (state.mode === 'mcq') {
    document.getElementById('mcq-options').style.display     = 'grid';
    document.getElementById('text-answer-wrap').style.display = 'none';
    const opts = document.querySelectorAll('.mcq-option');
    opts.forEach((btn, i) => {
      btn.textContent  = `${['A','B','C','D'][i]}. ${q.opts[i]}`;
      btn.className    = 'mcq-option';
      btn.disabled     = false;
      btn.onclick      = () => handleMCQ(i, q.ans, q.exp, opts);
    });
    startTimer(30);
  } else {
    document.getElementById('mcq-options').style.display      = 'none';
    document.getElementById('text-answer-wrap').style.display = 'flex';
    document.getElementById('text-answer-input').value        = '';
    document.getElementById('ai-feedback-box').style.display  = 'none';
    document.getElementById('submit-text-btn').disabled       = false;
    document.getElementById('submit-text-label').style.display = 'inline';
    document.getElementById('submit-spinner').style.display    = 'none';
  }
}

// ---- MCQ Handling ----
function handleMCQ(chosen, correct, explanation, opts) {
  clearTimer();
  opts.forEach(btn => { btn.disabled = true; });
  opts[correct].classList.add('correct');
  const resultEl = document.getElementById('mcq-result');
  const isRight  = chosen === correct;
  if (!isRight) opts[chosen].classList.add('wrong');
  else state.score++;

  state.answers.push({ q: state.questions[state.current].q, correct: isRight, explanation });

  resultEl.style.display = 'block';
  document.getElementById('result-icon').textContent    = isRight ? '✅' : '❌';
  document.getElementById('result-message').textContent = isRight ? 'Correct! Well done!' : 'Wrong answer!';
  document.getElementById('result-explanation').textContent = explanation;
  document.getElementById('next-btn').disabled = false;
}

// ---- Timer ----
function startTimer(seconds) {
  state.timeLeft = seconds;
  const display  = document.getElementById('timer-display');
  const timerEl  = document.getElementById('quiz-timer');
  if (display) display.textContent = seconds;
  state.timerInterval = setInterval(() => {
    state.timeLeft--;
    if (display) display.textContent = state.timeLeft;
    if (state.timeLeft <= 10) timerEl?.classList.add('urgent');
    if (state.timeLeft <= 0) {
      clearTimer();
      // Auto-fail current question
      if (state.mode === 'mcq') {
        const opts = document.querySelectorAll('.mcq-option');
        opts.forEach(b => b.disabled = true);
        opts[state.questions[state.current].ans].classList.add('correct');
        state.answers.push({ q: state.questions[state.current].q, correct: false, explanation: state.questions[state.current].exp });
        const resultEl = document.getElementById('mcq-result');
        resultEl.style.display = 'block';
        document.getElementById('result-icon').textContent    = '⏰';
        document.getElementById('result-message').textContent = 'Time\'s up!';
        document.getElementById('result-explanation').textContent = state.questions[state.current].exp;
        document.getElementById('next-btn').disabled = false;
      }
    }
  }, 1000);
}

function clearTimer() {
  clearInterval(state.timerInterval);
  document.getElementById('quiz-timer')?.classList.remove('urgent');
}

// ---- Text Answer ----
document.getElementById('submit-text-btn')?.addEventListener('click', async () => {
  const input = document.getElementById('text-answer-input').value.trim();
  if (!input) { alert('Please write your answer first.'); return; }

  document.getElementById('submit-text-btn').disabled = true;
  document.getElementById('submit-text-label').style.display = 'none';
  document.getElementById('submit-spinner').style.display    = 'block';

  await new Promise(r => setTimeout(r, 1500)); // simulate AI

  const fb = TEXT_FEEDBACK[Math.floor(Math.random() * TEXT_FEEDBACK.length)];
  state.score += fb.score / 10;
  state.answers.push({ q: state.questions[state.current].q, correct: fb.score >= 6, explanation: fb.text });

  document.getElementById('submit-spinner').style.display    = 'none';
  document.getElementById('submit-text-label').style.display = 'inline';

  const feedbackBox = document.getElementById('ai-feedback-box');
  feedbackBox.style.display = 'block';
  document.getElementById('ai-score-badge').textContent = `${fb.score}/10`;
  document.getElementById('ai-feedback-text').textContent  = fb.text;
  document.getElementById('next-btn').disabled = false;
});

// ---- Hint ----
document.getElementById('hint-btn')?.addEventListener('click', () => {
  const hintBox = document.getElementById('hint-box');
  hintBox.style.display = 'block';
  document.getElementById('hint-text').textContent = HINTS[state.topic] || 'Think carefully about the fundamental concepts of this topic.';
});

// ---- Next ----
document.getElementById('next-btn')?.addEventListener('click', () => {
  state.current++;
  if (state.current >= state.questions.length) endQuiz();
  else renderQuestion();
});

// ---- Quit ----
document.getElementById('quit-quiz-btn')?.addEventListener('click', () => {
  if (confirm('Quit quiz? Progress will be lost.')) showScreen('screen-select');
});

// ---- End Quiz ----
function endQuiz() {
  clearTimer();
  const total   = state.questions.length;
  const correct = state.answers.filter(a => a.correct).length;
  const wrong   = total - correct;
  const elapsed = Math.round((Date.now() - state.startTime) / 1000);
  const mins    = Math.floor(elapsed / 60);
  const secs    = elapsed % 60;
  const pct     = Math.round((correct / total) * 100);
  const xp      = correct * 10;

  document.getElementById('score-num').textContent  = correct;
  document.getElementById('score-total').textContent = `/${total}`;
  document.getElementById('res-correct').textContent = correct;
  document.getElementById('res-wrong').textContent   = wrong;
  document.getElementById('res-time').textContent    = `${mins}m ${secs}s`;
  document.getElementById('res-xp').textContent      = `+${xp} XP`;

  const msgs = [
    { min:80, msg:"🔥 Outstanding! You're a master!", emoji:"🏆" },
    { min:60, msg:"💪 Great job! Keep pushing!", emoji:"🎉" },
    { min:40, msg:"📚 Good try! Review and retry.", emoji:"🤔" },
    { min:0,  msg:"💡 Keep learning! You'll get it.", emoji:"📖" },
  ];
  const m = msgs.find(x => pct >= x.min);
  document.getElementById('score-msg').textContent   = m.msg;
  document.getElementById('results-emoji').textContent = m.emoji;

  // Score arc animation
  const arc = document.getElementById('score-arc');
  if (arc) {
    const circumference = 264;
    const offset = circumference - (pct / 100) * circumference;
    arc.style.transition = 'stroke-dashoffset 1.2s ease';
    arc.style.strokeDashoffset = offset;
  }

  // Review list
  const reviewList = document.getElementById('review-list');
  if (reviewList) {
    reviewList.innerHTML = state.answers.map((a, i) => `
      <div class="review-item">
        <div class="review-icon">${a.correct ? '✅' : '❌'}</div>
        <div>
          <div style="font-weight:600;margin-bottom:4px">Q${i+1}: ${a.q}</div>
          <div style="color:var(--text-muted);font-size:0.8rem">${a.explanation}</div>
        </div>
      </div>
    `).join('');
  }

  showScreen('screen-results');
}

// ---- Result Actions ----
document.getElementById('retake-btn')?.addEventListener('click', async () => {
  showScreen('screen-loading');
  await generateQuestions();
  startQuiz();
});

document.getElementById('new-topic-btn')?.addEventListener('click', () => {
  state.topic = null; state.mode = null;
  document.querySelectorAll('.topic-pill').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('.mode-card').forEach(b => b.classList.remove('selected'));
  updateStartBtn();
  showScreen('screen-select');
});
