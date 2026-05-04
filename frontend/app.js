/* ============================================================
 * SomaMeet (소마밋) — React 단일 페이지 (CDN + Babel 변환)
 * ------------------------------------------------------------
 * 화면 구성 (URL 라우팅은 location.pathname 기반)
 *   /                    → CreatePage : 회의(방) 생성
 *   /m/{invite_code}     → MeetingPage : 참여자 입력 + 결과/확정
 *
 * 책임 분리
 *   - api.*               : fetch 래퍼
 *   - <CreatePage>        : 회의 조건 입력 폼
 *   - <MeetingPage>       : 참여자 닉네임 → 일정 입력 → 추천 → 확정
 *   - <BusyEditor>        : 직접 입력(.manual) 시간 블록 편집기
 *   - <Timetable>         : 시간대별 가용 인원 시각화
 *   - <Candidates>        : 후보 3개 카드 + "이걸로 확정" 버튼
 *   - <DraftMessage>      : 안내 메시지 초안 + 복사 버튼
 *
 * 기획서 매핑
 *   - 3.3 워크플로우(주최자/참여자) 그대로 따라갑니다.
 *   - 4.4 프라이버시: 일정 제목/장소/설명은 화면 어디에도 표시하지 않습니다.
 * ============================================================
 */

const { useState, useEffect, useMemo } = React;

/* =============================================================
 * [SECTION 1] API 클라이언트 — 모든 호출은 여기로 모음
 * ============================================================= */
const api = {
  base: "",
  async req(path, opts = {}) {
    const res = await fetch(this.base + path, {
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      ...opts,
    });
    if (!res.ok) {
      const text = await res.text();
      let detail = text;
      try { detail = JSON.parse(text).detail || text; } catch (_) {}
      throw new Error(detail);
    }
    return res.json();
  },
  createMeeting: (body) => api.req("/api/meetings", { method: "POST", body: JSON.stringify(body) }),
  getMeeting:    (code) => api.req(`/api/meetings/${code}`),
  recommend:     (code) => api.req(`/api/meetings/${code}/recommend`),
  confirm:       (code, body) => api.req(`/api/meetings/${code}/confirm`, { method: "POST", body: JSON.stringify(body) }),
  message:       (code) => api.req(`/api/meetings/${code}/message`),

  addParticipant:  (code, nickname) =>
    api.req(`/api/meetings/${code}/participants`, { method: "POST", body: JSON.stringify({ nickname }) }),
  getParticipant:  (code, pid) => api.req(`/api/meetings/${code}/participants/${pid}`),
  submitManual:    (code, pid, blocks) =>
    api.req(`/api/meetings/${code}/participants/${pid}/manual`, {
      method: "POST", body: JSON.stringify({ busy_blocks: blocks }),
    }),
  submitGoogle:    (code, pid, blocks) =>
    api.req(`/api/meetings/${code}/participants/${pid}/google`, {
      method: "POST", body: JSON.stringify({ busy_blocks: blocks }),
    }),
  submitIcs: async (code, pid, file) => {
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch(`/api/meetings/${code}/participants/${pid}/ics`, { method: "POST", body: fd });
    if (!res.ok) throw new Error((await res.json()).detail || "ICS 업로드 실패");
    return res.json();
  },
  confirmParticipant: (code, pid) =>
    api.req(`/api/meetings/${code}/participants/${pid}/confirm`, { method: "POST" }),
};

/* =============================================================
 * [SECTION 2] App — URL 라우팅 (간단 버전)
 * ============================================================= */
function App() {
  const path = window.location.pathname;
  // /m/{code} 패턴 추출
  const m = path.match(/^\/m\/([A-Za-z0-9_-]+)\/?$/);
  const code = m ? m[1] : null;

  return (
    <div className="container">
      <header className="header">
        <div className="brand">SomaMeet <small>소마밋 · 일정 조율 Agent</small></div>
        <a className="btn ghost" href="/">+ 새 회의</a>
      </header>

      {code ? <MeetingPage code={code} /> : <CreatePage />}
    </div>
  );
}

/* =============================================================
 * [SECTION 3] CreatePage — 주최자: 회의 조건 입력
 * 기획서 3.3 - 주최자 1~3단계
 * ============================================================= */
function CreatePage() {
  const [form, setForm] = useState({
    title: "",
    start_date: "",
    end_date: "",
    duration_minutes: 60,
    headcount: 4,
    location_type: "any",
    buffer_minutes: 0,
    work_start_hour: 9,
    work_end_hour: 22,
  });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const payload = {
        ...form,
        duration_minutes: Number(form.duration_minutes),
        headcount: Number(form.headcount),
        buffer_minutes: Number(form.buffer_minutes),
        work_start_hour: Number(form.work_start_hour),
        work_end_hour: Number(form.work_end_hour),
      };
      const m = await api.createMeeting(payload);
      window.location.href = `/m/${m.invite_code}`;
    } catch (ex) {
      setErr(String(ex.message || ex));
    } finally {
      setBusy(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>1. 회의 조건 입력</h2>
      <div className="desc">
        주최자가 회의 조건을 입력하면 초대 링크가 만들어집니다.
        링크를 팀원에게 공유하면 각자 편한 방식으로 일정을 등록할 수 있습니다.
      </div>

      {err && <div className="error">{err}</div>}

      <label>회의 제목</label>
      <input className="input" required value={form.title} onChange={set("title")}
             placeholder="예: 4월 멘토링 회의" />

      <div style={{ height: 12 }} />

      <div className="row">
        <div>
          <label>후보 기간 시작</label>
          <input className="input" type="date" required value={form.start_date} onChange={set("start_date")} />
        </div>
        <div>
          <label>후보 기간 끝</label>
          <input className="input" type="date" required value={form.end_date} onChange={set("end_date")} />
        </div>
      </div>

      <div style={{ height: 12 }} />

      <div className="row-3">
        <div>
          <label>회의 길이(분)</label>
          <select className="input" value={form.duration_minutes} onChange={set("duration_minutes")}>
            {[30, 60, 90, 120, 150, 180].map(v => <option key={v} value={v}>{v}분</option>)}
          </select>
        </div>
        <div>
          <label>예정 인원</label>
          <input className="input" type="number" min="2" max="30"
                 value={form.headcount} onChange={set("headcount")} />
        </div>
        <div>
          <label>회의 형태</label>
          <select className="input" value={form.location_type} onChange={set("location_type")}>
            <option value="any">상관없음</option>
            <option value="online">온라인</option>
            <option value="offline">오프라인</option>
          </select>
        </div>
      </div>

      <div style={{ height: 12 }} />

      <div className="row-3">
        <div>
          <label>이동 시간 버퍼 (오프라인일 때만 적용)</label>
          <select className="input" value={form.buffer_minutes} onChange={set("buffer_minutes")}>
            {[0, 15, 30, 45, 60, 75].map(v => <option key={v} value={v}>{v}분</option>)}
          </select>
        </div>
        <div>
          <label>일과 시작</label>
          <select className="input" value={form.work_start_hour} onChange={set("work_start_hour")}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}
          </select>
        </div>
        <div>
          <label>일과 끝</label>
          <select className="input" value={form.work_end_hour} onChange={set("work_end_hour")}>
            {Array.from({ length: 24 }, (_, h) => h+1).map(h => <option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}
          </select>
        </div>
      </div>

      <div style={{ height: 18 }} />
      <button className="btn" disabled={busy}>{busy ? "생성 중..." : "회의 생성하고 초대 링크 받기"}</button>
    </form>
  );
}

/* =============================================================
 * [SECTION 4] MeetingPage — 참여자 입력 + 결과/확정
 * ============================================================= */
function MeetingPage({ code }) {
  const [meeting, setMeeting] = useState(null);
  const [error, setError] = useState(null);

  // 현재 브라우저에서 등록한 참여자 정보(localStorage에 보관)
  const [me, setMe] = useState(() => {
    const raw = localStorage.getItem(`somameet:${code}`);
    return raw ? JSON.parse(raw) : null;
  });

  const reload = async () => {
    try { setMeeting(await api.getMeeting(code)); }
    catch (e) { setError(String(e.message || e)); }
  };
  useEffect(() => { reload(); }, [code]);

  if (error) return <div className="card error">{error}</div>;
  if (!meeting) return <div className="card">불러오는 중...</div>;

  const inviteUrl = `${window.location.origin}/m/${meeting.invite_code}`;

  return (
    <>
      <MeetingHeader meeting={meeting} inviteUrl={inviteUrl} />

      {!me ? (
        <NicknameStep code={code} onRegistered={(p) => {
          const value = { id: p.id, nickname: p.nickname };
          localStorage.setItem(`somameet:${code}`, JSON.stringify(value));
          setMe(value);
          reload();
        }} />
      ) : (
        <ParticipantStep code={code} me={me} meeting={meeting} onChange={reload} />
      )}

      <ResultStep code={code} meeting={meeting} onConfirm={reload} />
    </>
  );
}

/* ---- 4-1) 회의 헤더 + 초대 링크 ---- */
function MeetingHeader({ meeting, inviteUrl }) {
  const copy = () => navigator.clipboard.writeText(inviteUrl);
  return (
    <div className="card">
      <h2>{meeting.title}</h2>
      <div>
        <span className="tag">기간 {meeting.start_date} ~ {meeting.end_date}</span>
        <span className="tag">길이 {meeting.duration_minutes}분</span>
        <span className="tag">인원 {meeting.headcount}명</span>
        <span className="tag">{({online:"온라인",offline:"오프라인",any:"형태 무관"})[meeting.location_type]}</span>
        {meeting.buffer_minutes > 0 && <span className="tag">버퍼 {meeting.buffer_minutes}분</span>}
        <span className="tag">현재 참여 {meeting.participants_count}명</span>
      </div>
      <div style={{ marginTop: 12 }}>
        <label>초대 링크</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="input" readOnly value={inviteUrl} />
          <button className="btn secondary" onClick={copy}>복사</button>
        </div>
      </div>
    </div>
  );
}

/* ---- 4-2) 닉네임 등록 ---- */
function NicknameStep({ code, onRegistered }) {
  const [nick, setNick] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const p = await api.addParticipant(code, nick.trim());
      onRegistered(p);
    } catch (ex) {
      setErr(String(ex.message || ex));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card" onSubmit={submit}>
      <h2>2. 닉네임 등록</h2>
      <div className="desc">
        로그인 없이 익명 닉네임으로 참여합니다.
        같은 회의 안에서 중복되지 않는 이름을 선택해 주세요.
      </div>
      {err && <div className="error">{err}</div>}
      <input className="input" required minLength={1} maxLength={20}
             placeholder="닉네임 (예: 지연)"
             value={nick} onChange={(e) => setNick(e.target.value)} />
      <div style={{ height: 12 }} />
      <button className="btn" disabled={busy || !nick.trim()}>등록</button>
    </form>
  );
}

/* ---- 4-3) 참여자 입력 단계 (3종 입력) ---- */
function ParticipantStep({ code, me, meeting, onChange }) {
  const [method, setMethod] = useState("manual");
  const [participant, setParticipant] = useState(null);
  const [err, setErr] = useState(null);

  const reload = async () => {
    try {
      const p = await api.getParticipant(code, me.id);
      setParticipant(p);
    } catch (e) { setErr(String(e.message || e)); }
  };
  useEffect(() => { reload(); }, [code, me.id]);

  const onSubmitted = async (p) => {
    setParticipant(p);
    onChange();
  };

  const onConfirm = async () => {
    try {
      const p = await api.confirmParticipant(code, me.id);
      setParticipant(p); onChange();
    } catch (e) { setErr(String(e.message || e)); }
  };

  return (
    <div className="card">
      <h2>3. 일정 입력 ({me.nickname})</h2>
      <div className="desc">
        편한 방식 1가지를 선택하세요. 입력된 일정의 <b>시작/종료 시간만</b>
        서버에 저장되며, 제목·장소·설명은 저장하지 않습니다.
      </div>

      {err && <div className="error">{err}</div>}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[
          ["manual", "직접 입력"],
          ["ics", ".ics 파일 업로드"],
          ["google", "Google Calendar"],
        ].map(([k, label]) => (
          <button key={k}
                  className={"btn " + (method === k ? "" : "secondary")}
                  onClick={() => setMethod(k)}>{label}</button>
        ))}
      </div>

      {method === "manual" && (
        <BusyEditor code={code} pid={me.id} onSubmitted={onSubmitted}
                    initialDate={meeting.start_date} />
      )}
      {method === "ics" && <IcsUploader code={code} pid={me.id} onSubmitted={onSubmitted} />}
      {method === "google" && <GoogleAdapter code={code} pid={me.id} onSubmitted={onSubmitted}
                                              meeting={meeting} />}

      {/* 검증 단계 — 기획서 3.2-4 */}
      {participant && participant.busy_blocks && participant.busy_blocks.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 16 }}>4. 추출 결과 확인</h2>
          <div className="desc">서버에 저장된 바쁜 시간 ({participant.busy_blocks.length}건)이 맞는지 확인해 주세요.</div>
          <div style={{ maxHeight: 180, overflow: "auto", background:"#fafbff", border:"1px solid #eef0f6", borderRadius: 8, padding: 8 }}>
            {participant.busy_blocks.map((b, i) => (
              <div key={i} style={{ fontSize: 13, padding: "2px 4px" }}>
                · {fmtRange(b.start, b.end)}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="btn" onClick={onConfirm}
                    disabled={participant.confirmed}>
              {participant.confirmed ? "확인 완료 ✓" : "이대로 맞아요"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- 4-3a) 직접 입력 편집기 ---- */
function BusyEditor({ code, pid, onSubmitted, initialDate }) {
  const [rows, setRows] = useState([{ date: initialDate, start: "09:00", end: "10:00" }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const update = (i, key, val) => {
    const next = [...rows]; next[i] = { ...next[i], [key]: val }; setRows(next);
  };
  const add = () => setRows([...rows, { date: initialDate, start: "09:00", end: "10:00" }]);
  const remove = (i) => setRows(rows.filter((_, idx) => idx !== i));

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      const blocks = rows
        .filter(r => r.date && r.start && r.end)
        .map(r => ({
          start: `${r.date}T${r.start}:00`,
          end:   `${r.date}T${r.end}:00`,
        }));
      const p = await api.submitManual(code, pid, blocks);
      onSubmitted(p);
    } catch (ex) {
      setErr(String(ex.message || ex));
    } finally { setBusy(false); }
  };

  return (
    <div>
      {err && <div className="error">{err}</div>}
      {rows.map((r, i) => (
        <div className="busy-row" key={i}>
          <div>
            <label>날짜</label>
            <input className="input" type="date" value={r.date}
                   onChange={(e) => update(i, "date", e.target.value)} />
          </div>
          <div>
            <label>시작 ~ 종료</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input className="input" type="time" value={r.start}
                     onChange={(e) => update(i, "start", e.target.value)} />
              <input className="input" type="time" value={r.end}
                     onChange={(e) => update(i, "end", e.target.value)} />
            </div>
          </div>
          <div>
            <label>&nbsp;</label>
            <button className="btn secondary" onClick={() => remove(i)}>삭제</button>
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn secondary" onClick={add}>+ 시간대 추가</button>
        <button className="btn" onClick={submit} disabled={busy}>{busy ? "저장 중..." : "제출"}</button>
      </div>
    </div>
  );
}

/* ---- 4-3b) .ics 업로더 ---- */
function IcsUploader({ code, pid, onSubmitted }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    if (!file) return;
    setErr(null); setBusy(true);
    try {
      const p = await api.submitIcs(code, pid, file);
      onSubmitted(p);
    } catch (ex) { setErr(String(ex.message || ex)); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div className="notice">
        Google Calendar / Apple Calendar / Outlook에서 내보낸 <b>.ics</b> 파일을 올려 주세요.
        파일은 처리 후 즉시 폐기되고, 시간 정보(시작/종료)만 저장됩니다.
      </div>
      {err && <div className="error">{err}</div>}
      <input type="file" accept=".ics,text/calendar"
             onChange={(e) => setFile(e.target.files?.[0] || null)} />
      <div style={{ height: 10 }} />
      <button className="btn" disabled={!file || busy} onClick={submit}>
        {busy ? "업로드 중..." : "업로드 후 분석"}
      </button>
    </div>
  );
}

/* ---- 4-3c) Google Calendar 어댑터 (MVP: free/busy JSON 직접 입력) ---- */
function GoogleAdapter({ code, pid, onSubmitted, meeting }) {
  // 실제 OAuth 흐름은 운영 단계의 작업이므로,
  // MVP 화면에선 "Google Calendar에서 내려받은 free/busy JSON을 붙여넣는"
  // 안내 + 데모 자동 생성 옵션을 제공합니다.
  const [json, setJson] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      let blocks = [];
      if (json.trim()) {
        const parsed = JSON.parse(json);
        blocks = parsed.map(b => ({ start: b.start, end: b.end }));
      } else {
        // 입력이 없으면 빈 배열로 제출 — '바쁜 시간 없음' 으로 처리됨
        blocks = [];
      }
      const p = await api.submitGoogle(code, pid, blocks);
      onSubmitted(p);
    } catch (ex) { setErr("JSON 형식 오류: " + (ex.message || ex)); }
    finally { setBusy(false); }
  };

  const example = `[
  {"start": "${meeting.start_date}T10:00:00", "end": "${meeting.start_date}T11:00:00"},
  {"start": "${meeting.start_date}T14:00:00", "end": "${meeting.start_date}T15:30:00"}
]`;

  return (
    <div>
      <div className="notice">
        <b>안내</b>: MVP에서는 OAuth 화면 대신, Google free/busy 결과 JSON을 붙여넣어 제출합니다.
        실제 배포 시에는 OAuth 2.0 화면이 이 자리에 들어갑니다.
      </div>
      {err && <div className="error">{err}</div>}
      <label>busy 블록 JSON (예시)</label>
      <textarea className="input" rows={6} value={json} onChange={(e) => setJson(e.target.value)}
                placeholder={example}/>
      <div style={{ height: 10 }} />
      <button className="btn" onClick={submit} disabled={busy}>
        {busy ? "저장 중..." : "Google free/busy 제출"}
      </button>
    </div>
  );
}

/* =============================================================
 * [SECTION 5] 결과 단계 — 타임테이블 + 후보 + 확정 + 메시지 초안
 * ============================================================= */
function ResultStep({ code, meeting, onConfirm }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [draft, setDraft] = useState(null);

  const load = async () => {
    try { setData(await api.recommend(code)); }
    catch (e) { setErr(String(e.message || e)); }
  };
  useEffect(() => { load(); }, [code, meeting.participants_count, meeting.confirmed_start]);

  const pickCandidate = async (slot) => {
    try {
      await api.confirm(code, { start: slot.start, end: slot.end });
      onConfirm();
      const m = await api.message(code);
      setDraft(m.text);
    } catch (e) { setErr(String(e.message || e)); }
  };

  const loadDraft = async () => {
    try { const m = await api.message(code); setDraft(m.text); }
    catch (e) { setErr(String(e.message || e)); }
  };

  if (err) return <div className="card error">{err}</div>;
  if (!data) return <div className="card">결과 계산 중...</div>;

  return (
    <>
      <div className="card">
        <h2>5. 타임테이블 (전체 참여자 기준 가용 인원)</h2>
        {data.note && <div className="notice">{data.note}</div>}
        <Timetable
          cells={data.timetable}
          totalParticipants={data.total_participants}
        />
      </div>

      <div className="card">
        <h2>6. 추천 후보 시간 (최대 3개)</h2>
        <Candidates
          candidates={data.candidates}
          onPick={pickCandidate}
          confirmed={meeting.confirmed_start}
        />
      </div>

      {meeting.confirmed_start && (
        <div className="card">
          <h2>7. 안내 메시지 초안</h2>
          <div className="desc">
            아래 내용을 복사해 메신저나 이메일에 직접 공유해 주세요.
            소마밋은 외부 채널로 자동 발송하지 않습니다.
          </div>
          {!draft && <button className="btn" onClick={loadDraft}>초안 보기</button>}
          {draft && <DraftMessage text={draft} />}
        </div>
      )}
    </>
  );
}

/* ---- 5-1) 타임테이블: 행=날짜, 열=시간 슬롯, 셀 색상=가용 인원 ---- */
function Timetable({ cells, totalParticipants }) {
  // 날짜별로 묶기
  const grouped = useMemo(() => {
    const byDay = new Map();
    for (const c of cells) {
      const d = c.start.slice(0, 10);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(c);
    }
    return Array.from(byDay.entries());
  }, [cells]);

  if (cells.length === 0) return <div className="desc">참여자가 일정을 입력하면 표가 채워집니다.</div>;

  // 헤더에 표시할 시각(슬롯 시작) — 첫 날 기준
  const cols = grouped[0][1].length;
  const headers = grouped[0][1].map((c) => c.start.slice(11, 16));

  // 인원 수에 따라 5단계 레벨로 매핑
  const lvl = (n) => {
    if (totalParticipants <= 0) return 0;
    const ratio = n / totalParticipants;
    if (ratio <= 0) return 0;
    if (ratio <= 0.25) return 1;
    if (ratio <= 0.5)  return 2;
    if (ratio <= 0.75) return 3;
    if (ratio < 1)     return 4;
    return 5;
  };

  return (
    <div>
      <div className="timetable" style={{ "--cols": cols }}>
        <div className="tt-head">
          <div className="tt-day">날짜 \ 시간</div>
          {headers.map((h, i) => (
            <div key={i} className="tt-cell" title={h}
                 style={{ fontSize: 9, textAlign: "center", color:"#666" }}>
              {h.endsWith(":00") ? h.slice(0,2) : ""}
            </div>
          ))}
        </div>
        {grouped.map(([day, list]) => (
          <div className="tt-row" key={day}>
            <div className="tt-day">{day}</div>
            {list.map((c, i) => (
              <div key={i}
                   className={`tt-cell lvl-${lvl(c.available_count)}`}
                   title={`${c.start.slice(11,16)}~${c.end.slice(11,16)}\n가능: ${c.available_count}/${totalParticipants}\n${c.available_nicknames.join(", ")}`} />
            ))}
          </div>
        ))}
      </div>
      <div className="tt-legend">
        가용 인원:
        <span><span className="sw" style={{background:"#fff", border:"1px solid #ddd"}}/>0</span>
        <span><span className="sw" style={{background:"#e6efff"}}/>≤25%</span>
        <span><span className="sw" style={{background:"#b9d2ff"}}/>≤50%</span>
        <span><span className="sw" style={{background:"#8db5ff"}}/>≤75%</span>
        <span><span className="sw" style={{background:"#5e92ff"}}/>~99%</span>
        <span><span className="sw" style={{background:"#2e6df5"}}/>전원</span>
      </div>
    </div>
  );
}

/* ---- 5-2) 후보 카드 ---- */
function Candidates({ candidates, onPick, confirmed }) {
  if (!candidates || candidates.length === 0) {
    return <div className="desc">조건에 맞는 후보가 아직 없습니다.</div>;
  }
  return (
    <div>
      {candidates.map((c, i) => {
        const isConfirmed = confirmed && (new Date(confirmed).getTime() === new Date(c.start).getTime());
        return (
          <div className="cand" key={i}>
            <div>
              <div className="when">{fmtRange(c.start, c.end)}</div>
              <div className="why">
                {c.reasons.map((r, j) => <span key={j} className="tag">{r}</span>)}
              </div>
            </div>
            <button className={"btn " + (isConfirmed ? "secondary" : "")}
                    onClick={() => onPick(c)}>
              {isConfirmed ? "확정됨 ✓" : "이걸로 확정"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ---- 5-3) 메시지 초안 + 복사 버튼 ---- */
function DraftMessage({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div>
      <pre className="draft">{text}</pre>
      <button className="btn" onClick={copy}>{copied ? "복사됨 ✓" : "복사"}</button>
    </div>
  );
}

/* =============================================================
 * [SECTION 6] 유틸
 * ============================================================= */
function fmtRange(startIso, endIso) {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const wd = ["일","월","화","수","목","금","토"][s.getDay()];
  const ymd = `${s.getFullYear()}-${String(s.getMonth()+1).padStart(2,"0")}-${String(s.getDate()).padStart(2,"0")}`;
  const tStr = (d) => `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  return `${ymd}(${wd}) ${tStr(s)} ~ ${tStr(e)}`;
}

/* =============================================================
 * [SECTION 7] 마운트
 * ============================================================= */
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
