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

  addParticipant:  (code, nickname, pin, bufferMinutes) =>
    api.req(`/api/meetings/${code}/participants`, {
      method: "POST",
      body: JSON.stringify({
        nickname,
        pin: pin || null,
        buffer_minutes: Number(bufferMinutes) || 0,
      }),
    }),
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

      <div className="row">
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

  // 세션 동안만 유지하는 내 정보 — localStorage 자동 진입 X.
  // (when2meet 처럼 매번 이름+핀 입력으로 본인 확인.)
  const [me, setMe] = useState(null);

  // 결과 패널 강제 리프레시 카운터.
  // 같은 사람이 일정만 수정/확정해도 participants_count 는 변하지 않으므로
  // 명시적 카운터로 ResultStep 의 useEffect 를 다시 트리거합니다.
  const [refreshTick, setRefreshTick] = useState(0);

  const reload = async () => {
    try {
      setMeeting(await api.getMeeting(code));
      setRefreshTick((t) => t + 1);
    }
    catch (e) { setError(String(e.message || e)); }
  };
  useEffect(() => { reload(); }, [code]);

  if (error) return <div className="card error">{error}</div>;
  if (!meeting) return <div className="card">불러오는 중...</div>;

  const inviteUrl = `${window.location.origin}/m/${meeting.invite_code}`;

  const logout = () => setMe(null);

  return (
    <>
      <MeetingHeader meeting={meeting} inviteUrl={inviteUrl}
                     me={me} onLogout={logout} />

      {!me ? (
        <NicknameStep code={code} meeting={meeting} onRegistered={(p) => {
          setMe({ id: p.id, nickname: p.nickname });
          reload();
        }} />
      ) : (
        <ParticipantStep code={code} me={me} meeting={meeting} onChange={reload} />
      )}

      <ResultStep code={code} meeting={meeting}
                  refresh={refreshTick} onConfirm={reload} />
    </>
  );
}

/* ---- 4-1) 회의 헤더 + 초대 링크 ---- */
function MeetingHeader({ meeting, inviteUrl, me, onLogout }) {
  const copy = () => navigator.clipboard.writeText(inviteUrl);
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>{meeting.title}</h2>
        {me && (
          <div style={{ fontSize: 13, color: "#555" }}>
            현재: <b>{me.nickname}</b>
            <button className="btn ghost" onClick={onLogout}
                    style={{ marginLeft: 8 }}>다른 사람으로 입장</button>
          </div>
        )}
      </div>
      <div style={{ marginTop: 8 }}>
        <span className="tag">기간 {meeting.start_date} ~ {meeting.end_date}</span>
        <span className="tag">길이 {meeting.duration_minutes}분</span>
        <span className="tag">인원 {meeting.headcount}명</span>
        <span className="tag">{({online:"온라인",offline:"오프라인",any:"형태 무관"})[meeting.location_type]}</span>
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

/* ---- 4-2) 닉네임 + PIN + (조건부) 이동시간 버퍼 입장 ---- */
function NicknameStep({ code, meeting, onRegistered }) {
  const [nick, setNick] = useState("");
  const [pin, setPin] = useState("");
  const [buffer, setBuffer] = useState(0);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  // 회의 형태가 오프라인 또는 상관없음 일 때만 버퍼 입력 표시.
  // (온라인 고정 회의에서는 버퍼가 의미 없음.)
  const showBuffer =
    meeting?.location_type === "offline" || meeting?.location_type === "any";

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      // 백엔드 분기:
      //  - 처음 본 닉네임 → 새 등록 (PIN/버퍼 함께 저장)
      //  - 같은 닉네임 + 같은 PIN → 기존 참여자로 재진입 (버퍼는 입력값으로 갱신)
      //  - 같은 닉네임 + 다른 PIN → 409 에러
      const p = await api.addParticipant(
        code, nick.trim(), pin.trim() || null, showBuffer ? buffer : 0
      );
      onRegistered(p);
    } catch (ex) {
      setErr(String(ex.message || ex));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card" onSubmit={submit}>
      <h2>2. 입장</h2>
      <div className="desc">
        로그인 없이 익명 닉네임으로 참여합니다.
        다음에 다시 들어와 일정을 수정하고 싶다면 <b>PIN</b>을 함께 설정해 두세요.
        같은 닉네임으로 다시 들어올 때 같은 PIN을 입력하면 기존 일정에 이어서 작업할 수 있습니다.
      </div>
      {err && <div className="error">{err}</div>}

      <div className="row">
        <div>
          <label>닉네임</label>
          <input className="input" required minLength={1} maxLength={20}
                 placeholder="예: 김소마"
                 value={nick} onChange={(e) => setNick(e.target.value)} />
        </div>
        <div>
          <label>PIN (선택)</label>
          <input className="input" type="password" minLength={2} maxLength={20}
                 placeholder="2~20자 (비워둬도 됩니다)"
                 value={pin} onChange={(e) => setPin(e.target.value)} />
        </div>
      </div>

      {showBuffer && (
        <>
          <div style={{ height: 12 }} />
          <label>내 이동시간 버퍼 (오프라인 이동 여유분)</label>
          <select className="input" value={buffer}
                  onChange={(e) => setBuffer(Number(e.target.value))}>
            {[0, 15, 30, 45, 60, 75].map(v => (
              <option key={v} value={v}>{v === 0 ? "없음" : `${v}분`}</option>
            ))}
          </select>
          <div className="desc" style={{ marginTop: 4 }}>
            예: 30분으로 설정하면, 13:00–14:00 일정이 있을 때
            12:30–14:30 가 바쁜 시간으로 처리됩니다.
          </div>
        </>
      )}

      <div style={{ height: 12 }} />
      <button className="btn" disabled={busy || !nick.trim()}>
        {busy ? "확인 중..." : "입장"}
      </button>
    </form>
  );
}

/* ---- 4-3) 참여자 입력 단계 (3종 입력) ---- */
function ParticipantStep({ code, me, meeting, onChange }) {
  const [method, setMethod] = useState("manual");
  const [participant, setParticipant] = useState(null);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(false);

  const reload = async () => {
    try {
      const p = await api.getParticipant(code, me.id);
      setParticipant(p);
    } catch (e) { setErr(String(e.message || e)); }
  };
  useEffect(() => { reload(); }, [code, me.id]);

  const onSubmitted = async (p) => {
    setParticipant(p);
    setEditing(false);
    onChange();
  };

  const onConfirm = async () => {
    try {
      const p = await api.confirmParticipant(code, me.id);
      setParticipant(p); onChange();
    } catch (e) { setErr(String(e.message || e)); }
  };

  // 회의 후보 기간 안에 들어오는 블록만 필터링.
  // (참여자가 .ics를 통째로 올리면 회의와 무관한 일정도 들어오므로, 화면엔 회의 기간 것만 표시)
  const inRangeBlocks = useMemo(() => {
    if (!participant?.busy_blocks) return [];
    return filterBlocksInRange(
      participant.busy_blocks, meeting.start_date, meeting.end_date
    );
  }, [participant, meeting.start_date, meeting.end_date]);

  return (
    <div className="card">
      <h2>3. 일정 입력 ({me.nickname})</h2>
      <div className="desc">
        편한 방식 1가지를 선택하세요. 입력된 일정의 <b>시작/종료 시간만</b>
        서버에 저장되며, 제목·장소·설명은 저장하지 않습니다.
      </div>

      {err && <div className="error">{err}</div>}

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
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

      {/* 검증 단계 — 회의 기간 안의 블록이 1개라도 있을 때만 표시 */}
      {participant && inRangeBlocks.length > 0 && !editing && (
        <div style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 16 }}>4. 추출 결과 확인</h2>
          <div className="desc">
            회의 후보 기간({meeting.start_date} ~ {meeting.end_date}) 안에서
            바쁜 시간 <b>{inRangeBlocks.length}건</b>이 등록되었습니다. 맞는지 확인해 주세요.
          </div>
          <div style={{ maxHeight: 180, overflow: "auto", background:"#fafbff", border:"1px solid #eef0f6", borderRadius: 8, padding: 8 }}>
            {inRangeBlocks.map((b, i) => (
              <div key={i} style={{ fontSize: 13, padding: "2px 4px" }}>
                · {fmtRange(b.start, b.end)}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button className="btn" onClick={onConfirm}
                    disabled={participant.confirmed}>
              {participant.confirmed ? "확인 완료 ✓" : "이대로 맞아요"}
            </button>
            <button className="btn secondary" onClick={() => setEditing(true)}>
              결과가 다르다면 직접 수정
            </button>
          </div>
        </div>
      )}

      {/* 드래그 편집기 — 15분 단위 그리드 */}
      {participant && editing && (
        <div style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 16 }}>4. 직접 수정 (드래그로 채우기/지우기)</h2>
          <div className="desc">
            바쁜 시간 칸을 <b>드래그</b>로 칠하거나 지울 수 있습니다 (15분 단위).
            칠해진 칸 위에서 드래그를 시작하면 지워지고, 빈 칸에서 시작하면 채워집니다.
          </div>
          <DragEditor
            meeting={meeting}
            initialBlocks={inRangeBlocks}
            onCancel={() => setEditing(false)}
            onSave={async (blocks) => {
              try {
                const p = await api.submitManual(code, me.id, blocks);
                onSubmitted(p);
              } catch (e) { setErr(String(e.message || e)); }
            }}
          />
        </div>
      )}
    </div>
  );
}

/* ---- 4-3z) 드래그 편집기 (when2meet 스타일, 15분 단위) ----
 *
 * 행 = 시간(15분 슬롯), 열 = 날짜.
 * pointerdown 시 시작 셀의 상태로 paint mode 결정 (off→fill, on→erase),
 * pointerover 동안 같은 mode 적용, pointerup 또는 이탈 시 종료.
 *
 * 선택된 셀들을 (날짜, 시간) 키로 보관하고, 저장 시 같은 날짜의
 * 연속된 슬롯들을 병합해 (start, end) 블록으로 변환합니다.
 * --------------------------------------------------------------- */
const DRAG_SLOT_MINUTES = 15;

function DragEditor({ meeting, initialBlocks, onSave, onCancel }) {
  const days = useMemo(
    () => enumDays(meeting.start_date, meeting.end_date),
    [meeting.start_date, meeting.end_date]
  );
  const slots = useMemo(
    () => enumDaySlots(meeting.work_start_hour, meeting.work_end_hour, DRAG_SLOT_MINUTES),
    [meeting.work_start_hour, meeting.work_end_hour]
  );

  // 셀 키 = `${YYYY-MM-DD}|${HH:MM}` (그 슬롯의 시작)
  const [selected, setSelected] = useState(() =>
    blocksToCellSet(initialBlocks, days, slots)
  );
  const [drag, setDrag] = useState(null); // { mode: 'fill' | 'erase' }
  const [busy, setBusy] = useState(false);

  const keyOf = (day, slot) => `${day}|${slot}`;

  const startDrag = (day, slot) => {
    const k = keyOf(day, slot);
    const isOn = selected.has(k);
    const mode = isOn ? "erase" : "fill";
    const next = new Set(selected);
    if (isOn) next.delete(k); else next.add(k);
    setSelected(next);
    setDrag({ mode });
  };

  const continueDrag = (day, slot) => {
    if (!drag) return;
    const k = keyOf(day, slot);
    setSelected((prev) => {
      const n = new Set(prev);
      if (drag.mode === "fill") n.add(k); else n.delete(k);
      return n;
    });
  };

  const endDrag = () => setDrag(null);

  // 마우스가 그리드 밖에서 떼졌을 때도 종료되도록 전역 리스너 부착
  useEffect(() => {
    if (!drag) return;
    const up = () => setDrag(null);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [drag]);

  const save = async () => {
    setBusy(true);
    try {
      const blocks = cellSetToBlocks(selected, DRAG_SLOT_MINUTES);
      await onSave(blocks);
    } finally { setBusy(false); }
  };

  const slotLabel = (s) => (s.endsWith(":00") ? s : "");

  return (
    <div>
      <div className="drag-grid"
           style={{ "--day-cols": days.length }}
           onPointerLeave={endDrag}>
        {/* 헤더: 빈칸 + 날짜들 */}
        <div className="dg-cell dg-header dg-corner">시간 \ 날짜</div>
        {days.map((d) => (
          <div key={d} className="dg-cell dg-header">{shortDay(d)}</div>
        ))}

        {/* 본문: 시간 라벨 + 날짜 셀들 */}
        {slots.map((s) => (
          <React.Fragment key={s}>
            <div className="dg-cell dg-time">{slotLabel(s)}</div>
            {days.map((d) => {
              const k = keyOf(d, s);
              const on = selected.has(k);
              return (
                <div
                  key={k}
                  className={"dg-cell dg-slot " + (on ? "on" : "off")}
                  onPointerDown={(e) => { e.preventDefault(); startDrag(d, s); }}
                  onPointerEnter={() => continueDrag(d, s)}
                />
              );
            })}
          </React.Fragment>
        ))}
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button className="btn" onClick={save} disabled={busy}>
          {busy ? "저장 중..." : "이 내용으로 저장"}
        </button>
        <button className="btn secondary" onClick={onCancel}>취소</button>
        <button className="btn ghost" onClick={() => setSelected(new Set())}>
          전부 지우기
        </button>
      </div>
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
function ResultStep({ code, meeting, refresh, onConfirm }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [draft, setDraft] = useState(null);
  // 활성 모드 — 회의가 'any' 일 때만 토글로 변경 가능. 그 외엔 data.mode 고정.
  const [activeMode, setActiveMode] = useState(null);
  // "모두 가능 시간만" 토글 — 활성 시 전원 가능 슬롯만 색을 채움.
  const [allOnly, setAllOnly] = useState(false);

  const load = async () => {
    try {
      const d = await api.recommend(code);
      setData(d);
      // 처음 로드 또는 회의 모드가 바뀐 경우만 활성 모드 초기화
      setActiveMode((prev) =>
        prev === "online" || prev === "offline" ? prev : d.mode
      );
    }
    catch (e) { setErr(String(e.message || e)); }
  };
  // refresh 카운터, 확정 변경, 코드 변경 시 자동 재호출 → 자동 새로고침
  useEffect(() => { load(); }, [code, refresh, meeting.confirmed_start]);

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

  // 활성 모드에 따라 어떤 timetable/candidates 를 보여줄지 선택
  const useAlt = data.switchable && activeMode === data.alt_mode;
  const shownTable = useAlt ? (data.alt_timetable || []) : data.timetable;
  const shownCandidates = useAlt ? (data.alt_candidates || []) : data.candidates;

  return (
    <>
      <div className="card">
        <div className="card-header">
          <h2 style={{ margin: 0 }}>5. 타임테이블</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button"
                    className={"btn " + (allOnly ? "" : "secondary")}
                    onClick={() => setAllOnly((v) => !v)}>
              모두 가능 시간만 표시하기
            </button>
            <ModeSwitch data={data} active={activeMode} onChange={setActiveMode} />
          </div>
        </div>
        {data.note && <div className="notice" style={{ marginTop: 8 }}>{data.note}</div>}
        <div style={{ height: 8 }} />
        <Timetable
          cells={shownTable}
          totalParticipants={data.total_participants}
          headcount={meeting.headcount}
          allOnly={allOnly}
        />
      </div>

      <div className="card">
        <div className="card-header">
          <h2 style={{ margin: 0 }}>6. 추천 후보 시간 (최대 3개)</h2>
          {/* 현재 모드를 명확히 표시 — 위 스위치를 토글하면 후보 목록이 그 모드 기준으로 다시 그려집니다. */}
          <span className="tag">
            {((activeMode || data.mode) === "online" ? "온라인" : "오프라인") + " 기준"}
          </span>
        </div>
        <Candidates
          candidates={shownCandidates}
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

/* ---- 5-0) 모드 스위치 — 우측 상단 ---- */
function ModeSwitch({ data, active, onChange }) {
  if (!data) return null;
  // 회의가 online/offline 으로 고정 → 단순 라벨
  if (!data.switchable) {
    const label = data.mode === "online" ? "온라인" : "오프라인";
    return <span className="tag" style={{ fontSize: 12 }}>{label}</span>;
  }
  // 'any' → 토글 스위치
  const cur = active || data.mode;
  return (
    <div className="mode-switch" role="group" aria-label="회의 형태 전환">
      <button type="button"
              className={"ms-btn " + (cur === "online" ? "active" : "")}
              onClick={() => onChange("online")}>온라인</button>
      <button type="button"
              className={"ms-btn " + (cur === "offline" ? "active" : "")}
              onClick={() => onChange("offline")}>오프라인</button>
    </div>
  );
}

/* ---- 5-1) 타임테이블: 행=날짜, 열=시간 (15분 단위, 1시간=4칸) ----
 *
 * - 첫 행: 시간 헤더. 정시(:00)에만 라벨을 표시하고 나머지는 빈칸.
 * - 첫 열: 날짜 라벨 (예: "5/4(월)").
 * - 정시 칸의 좌측 경계선을 진하게 그어 1시간 단위가 한눈에 들어오도록 함.
 * --------------------------------------------------------------- */
function Timetable({ cells, totalParticipants, headcount, allOnly }) {
  const { days, times, lookup } = useMemo(() => {
    const daySet = new Set();
    const timeSet = new Set();
    const lookup = new Map();
    for (const c of cells) {
      const d = c.start.slice(0, 10);     // YYYY-MM-DD
      const t = c.start.slice(11, 16);    // HH:MM
      daySet.add(d); timeSet.add(t);
      lookup.set(`${d}|${t}`, c);
    }
    return {
      days: Array.from(daySet).sort(),
      times: Array.from(timeSet).sort(),
      lookup,
    };
  }, [cells]);

  if (cells.length === 0) {
    return <div className="desc">참여자가 일정을 입력하면 표가 채워집니다.</div>;
  }

  // 색칠 분모: 회의 생성 시 입력한 headcount(목표 인원).
  //  - 10명 회의 → 0/10/20/.../100% 자동 단계
  //  - 7명 회의  → 0/14/28/.../100% (alpha 비율 그대로)
  const denom = headcount && headcount > 0 ? headcount : (totalParticipants || 1);
  // "모두 가능" 기준: 현재 등록된 사람 모두 가능한 슬롯
  const allCount = totalParticipants || 0;

  const cellStyle = (n) => {
    if (allOnly) {
      return n > 0 && n >= allCount
        ? { background: "rgba(46, 109, 245, 1)" }
        : undefined;
    }
    const r = Math.min(1, Math.max(0, n / denom));
    if (r === 0) return undefined;
    return { background: `rgba(46, 109, 245, ${r.toFixed(3)})` };
  };

  const isHourMark = (t) => t.endsWith(":00");

  return (
    <div className="timetable-h" style={{ "--time-cols": times.length }}>
      {/* 헤더 행: 좌상단 + 시간 라벨들 */}
      <div className="tth-cell tth-corner">날짜 \ 시간</div>
      {times.map((t) => (
        <div key={t}
             className={"tth-cell tth-time-head " + (isHourMark(t) ? "hour-mark" : "")}>
          {isHourMark(t) ? t.slice(0, 2) : ""}
        </div>
      ))}

      {/* 본문: 각 행 = 한 날짜 */}
      {days.map((d) => (
        <React.Fragment key={d}>
          <div className="tth-cell tth-day">{shortDay(d)}</div>
          {times.map((t) => {
            const c = lookup.get(`${d}|${t}`);
            const hourCls = isHourMark(t) ? "hour-mark" : "";
            const n = c ? c.available_count : 0;
            return (
              <div key={t}
                   className={`tth-cell tth-slot ${hourCls}`}
                   style={cellStyle(n)}
                   title={c
                     ? `${d} ${t}~${c.end.slice(11,16)}\n가능: ${n}/${denom}\n${c.available_nicknames.join(", ")}`
                     : ""} />
            );
          })}
        </React.Fragment>
      ))}
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

// "YYYY-MM-DD" 두 개를 받아 그 사이의 모든 날짜 문자열 배열을 반환 (양 끝 포함)
function enumDays(startStr, endStr) {
  const out = [];
  const s = new Date(startStr + "T00:00:00");
  const e = new Date(endStr + "T00:00:00");
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// 일과 시간 안에서 step분 단위 시작 시각 라벨 배열 반환 ("09:00", "09:15", ...)
function enumDaySlots(startHour, endHour, stepMinutes) {
  const out = [];
  const total = (endHour - startHour) * 60;
  for (let m = 0; m + stepMinutes <= total; m += stepMinutes) {
    const h = startHour + Math.floor(m / 60);
    const mm = m % 60;
    out.push(`${String(h).padStart(2,"0")}:${String(mm).padStart(2,"0")}`);
  }
  return out;
}

// 블록 리스트가 주어졌을 때 셀 집합으로 변환 (드래그 편집기 초기 상태용)
function blocksToCellSet(blocks, days, slots) {
  const set = new Set();
  if (!blocks || !days.length || !slots.length) return set;
  // 슬롯 순서대로 분 단위 인덱스 만들기
  const slotMin = (s) => parseInt(s.slice(0,2),10)*60 + parseInt(s.slice(3,5),10);
  const stepMinutes = slotMin(slots[1] || "00:15") - slotMin(slots[0] || "00:00");
  const slotsByDay = new Map(days.map((d) => [d, slots]));

  for (const b of blocks) {
    const s = new Date(b.start);
    const e = new Date(b.end);
    for (let cur = new Date(s); cur < e; cur.setMinutes(cur.getMinutes() + stepMinutes)) {
      const day = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,"0")}-${String(cur.getDate()).padStart(2,"0")}`;
      if (!slotsByDay.has(day)) continue;
      const slot = `${String(cur.getHours()).padStart(2,"0")}:${String(cur.getMinutes()).padStart(2,"0")}`;
      if (slots.includes(slot)) set.add(`${day}|${slot}`);
    }
  }
  return set;
}

// 셀 집합을 (start, end) 블록 리스트로 변환
// 같은 날짜 안에서 연속된 슬롯끼리 묶음.
function cellSetToBlocks(set, stepMinutes) {
  // {day -> sorted [slotMin]}
  const byDay = new Map();
  for (const k of set) {
    const [day, slot] = k.split("|");
    const m = parseInt(slot.slice(0,2),10)*60 + parseInt(slot.slice(3,5),10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(m);
  }

  const blocks = [];
  for (const [day, mins] of byDay) {
    mins.sort((a,b) => a-b);
    let runStart = null;
    let prev = null;
    const flush = () => {
      if (runStart === null) return;
      const startISO = `${day}T${pad2(Math.floor(runStart/60))}:${pad2(runStart%60)}:00`;
      const endMin = prev + stepMinutes;
      const endISO = `${day}T${pad2(Math.floor(endMin/60))}:${pad2(endMin%60)}:00`;
      blocks.push({ start: startISO, end: endISO });
      runStart = null; prev = null;
    };
    for (const m of mins) {
      if (runStart === null) { runStart = m; prev = m; continue; }
      if (m === prev + stepMinutes) { prev = m; continue; }
      flush();
      runStart = m; prev = m;
    }
    flush();
  }
  return blocks;
}

function pad2(n) { return String(n).padStart(2, "0"); }

// 회의 후보 기간 [start_date, end_date] 안에 들어오는 블록만 남김
function filterBlocksInRange(blocks, startDate, endDate) {
  const s = new Date(startDate + "T00:00:00").getTime();
  const e = new Date(endDate   + "T23:59:59").getTime();
  return (blocks || []).filter((b) => {
    const bs = new Date(b.start).getTime();
    return bs >= s && bs <= e;
  });
}

// "YYYY-MM-DD" → "5/4(월)" 식의 짧은 라벨
function shortDay(ymd) {
  const d = new Date(ymd + "T00:00:00");
  const wd = ["일","월","화","수","목","금","토"][d.getDay()];
  return `${d.getMonth()+1}/${d.getDate()}(${wd})`;
}

/* =============================================================
 * [SECTION 7] 마운트
 * ============================================================= */
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
