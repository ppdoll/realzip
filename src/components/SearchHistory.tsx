'use client';

import type { ConfidenceLevel } from '@/lib/types';
import { CONFIDENCE_LABEL, krwShort, pyeong } from '@/lib/format';

/**
 * 이번 세션에서 조회한 단지 기록.
 *
 * 로그인이 없으므로 저장하지 않는다 — 페이지를 열고 있는 동안만 메모리에 남는다.
 * (localStorage 도 쓰지 않는다. 새로 고치면 사라지는 것이 의도된 동작.)
 */
export type HistoryEntry = {
  /** 같은 단지·같은 평형은 하나로 본다 */
  key: string;
  /** 조회 시각 (epoch ms) */
  at: number;
  lawdCd: string;
  regionLabel: string;
  aptSeq: string;
  aptNm: string;
  umdNm: string;
  /** 전용면적 m² */
  area: number;
  /** 예상 실거래가 (만원). 표본이 없어 계산 못 했으면 null */
  price: number | null;
  confidence: ConfidenceLevel | null;
};

export const HISTORY_LIMIT = 10;

function hhmm(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

type Props = {
  entries: HistoryEntry[];
  /** 현재 보고 있는 항목 */
  activeKey: string | null;
  onSelect: (entry: HistoryEntry) => void;
  onClear: () => void;
};

export default function SearchHistory({ entries, activeKey, onSelect, onClear }: Props) {
  return (
    <aside className="card history" aria-labelledby="history-title">
      <div className="history-head">
        <h2 className="card-title" id="history-title">
          최근 조회
        </h2>
        {entries.length > 0 && (
          <button className="link-btn" onClick={onClear}>
            지우기
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="card-sub" style={{ marginBottom: 0 }}>
          단지를 조회하면 최근 {HISTORY_LIMIT}건이 여기 쌓입니다. 저장은 하지 않으니 페이지를
          새로 열면 사라집니다.
        </p>
      ) : (
        <>
          <ol className="history-list">
            {entries.map((e) => (
              <li key={e.key}>
                <button
                  className="history-item"
                  aria-current={activeKey === e.key ? 'true' : undefined}
                  onClick={() => onSelect(e)}
                  aria-label={`${e.aptNm} 전용 ${e.area}제곱미터, ${
                    e.price != null ? `예상 ${krwShort(e.price)}` : '예상가 없음'
                  }, ${hhmm(e.at)} 조회`}
                >
                  <span className="row-1">
                    <span className="nm">{e.aptNm}</span>
                    <span className="time tabular">{hhmm(e.at)}</span>
                  </span>
                  <span className="row-2">
                    {e.regionLabel.replace(/^(서울특별시|.*?(?:광역시|특별자치시|특별자치도|도)) /, '')}{' '}
                    {e.umdNm} · {e.area}㎡({pyeong(e.area)}평)
                  </span>
                  <span className="row-3">
                    <b className="tabular">{e.price != null ? krwShort(e.price) : '—'}</b>
                    {e.confidence && (
                      <span className="muted"> 신뢰도 {CONFIDENCE_LABEL[e.confidence]}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <p className="history-foot">
            저장하지 않습니다 — 페이지를 새로 열면 사라집니다.
          </p>
        </>
      )}
    </aside>
  );
}
