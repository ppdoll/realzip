'use client';

import { useState } from 'react';
import type { Rent, RentSummary } from '@/lib/types';
import { CONFIDENCE_LABEL, krw, krwShort, pyeong, shortDate } from '@/lib/format';

export type RentResponse = {
  selectedArea: number;
  summary: RentSummary | null;
  rents: Rent[];
  complexRentCount: number;
  meta: { mode: string; fetchedMonths: number; errors: { ym: string; message: string }[] };
};

type Props = {
  data: RentResponse | null;
  loading: boolean;
  error: string | null;
  /** 같은 평형의 매매 추정가 (만원) — 전세가율 계산용 */
  salePrice: number | null;
};

/** 전월세 자료는 매매와 별도 활용신청이 필요해서, 그 오류만 따로 안내한다. */
function NotEnabled({ message }: { message: string }) {
  return (
    <div className="callout">
      <b>전월세 자료는 매매와 별도로 활용신청이 필요합니다.</b>
      <br />
      <a
        href="https://www.data.go.kr/data/15126474/openapi.do"
        target="_blank"
        rel="noreferrer noopener"
      >
        국토교통부_아파트 전월세 실거래가 자료
      </a>
      {' '}페이지에서 <b>활용신청</b>을 누르면(자동승인) 같은 인증키로 바로 동작합니다.
      <br />
      <span className="muted" style={{ fontSize: 12 }}>
        {message}
      </span>
    </div>
  );
}

export default function RentCard({ data, loading, error, salePrice }: Props) {
  const [open, setOpen] = useState(false);

  if (loading) {
    return (
      <div className="card">
        <h2 className="card-title">전월세</h2>
        <p className="card-sub" style={{ marginBottom: 0 }}>
          <span className="spinner" /> 전월세 실거래를 불러오는 중…
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <h2 className="card-title">전월세</h2>
        {/* 코드 30 = 등록되지 않은 서비스키 → 활용신청 안내 */}
        {/활용신청|등록되지 않은|30:/.test(error) ? (
          <NotEnabled message={error} />
        ) : /테이블이 없습니다/.test(error) ? (
          <div className="callout">
            <b>전월세 테이블이 아직 없습니다.</b>
            <br />
            <code>src/lib/schema.sql</code> 의 <code>apt_rent</code> ·{' '}
            <code>rent_ingest_log</code> 부분을 Supabase SQL Editor 에서 실행하거나{' '}
            <code>npm run db:setup</code> 을 다시 돌려주세요.
          </div>
        ) : (
          <div className="callout error">{error}</div>
        )}
      </div>
    );
  }

  if (!data) return null;

  const s = data.summary;
  const ratio =
    s?.jeonsePrice != null && salePrice != null && salePrice > 0
      ? Math.round((s.jeonsePrice / salePrice) * 1000) / 10
      : null;

  const hasAny = (s?.jeonseCount ?? 0) + (s?.monthlyCount ?? 0) > 0;

  return (
    <div className="card">
      <h2 className="card-title">
        전월세 · 전용 {data.selectedArea}㎡ ({pyeong(data.selectedArea)}평)
      </h2>
      <p className="card-sub">
        전세 추정은 매매와 같은 방식입니다 — 지역 전세 가격지수로 과거 보증금을 현재 시점으로
        환산한 뒤 면적·층 유사도로 가중합니다. <b>월세 계약은 전세 추정에서 제외</b>했습니다
        (전월세전환율이 시기·지역마다 달라 오차를 키웁니다).
      </p>

      {!hasAny ? (
        <div className="callout">
          이 평형의 최근 3년 전월세 신고가 없습니다.
          {data.complexRentCount > 0
            ? ` (이 단지 전체로는 ${data.complexRentCount}건 있습니다 — 다른 평형을 골라보세요.)`
            : ''}
        </div>
      ) : (
        <>
          <div className="hero">
            <div className="hero-figure">
              <div className="label">전세 추정 보증금 · {s?.asOf}</div>
              <div className="value">{s?.jeonsePrice != null ? krw(s.jeonsePrice) : '—'}</div>
              {s?.jeonseLow != null && s?.jeonseHigh != null && (
                <div className="range">
                  80% 예상 범위 {krwShort(s.jeonseLow)} ~ {krwShort(s.jeonseHigh)}
                </div>
              )}
            </div>
            {s?.jeonseConfidence && (
              <span className="badge">신뢰도 {CONFIDENCE_LABEL[s.jeonseConfidence]}</span>
            )}
          </div>

          <div className="tiles">
            <div className="tile">
              <div className="label">전세가율</div>
              <div className="value tabular">{ratio != null ? `${ratio}%` : '—'}</div>
              <div className="foot">
                {ratio != null ? '전세 추정 ÷ 매매 추정' : '매매 추정가가 없어 계산 불가'}
              </div>
            </div>
            <div className="tile">
              <div className="label">최근 전세</div>
              <div className="value tabular">
                {s?.lastJeonse ? krwShort(s.lastJeonse.deposit) : '—'}
              </div>
              <div className="foot">
                {s?.lastJeonse
                  ? `${shortDate(s.lastJeonse.dealDate)} · ${s.lastJeonse.floor ?? '—'}층`
                  : '기록 없음'}
              </div>
            </div>
            <div className="tile">
              <div className="label">최근 월세</div>
              <div className="value tabular">
                {s?.lastMonthly
                  ? `${krwShort(s.lastMonthly.deposit)} / ${s.lastMonthly.monthlyRent}`
                  : '—'}
              </div>
              <div className="foot">
                {s?.lastMonthly
                  ? `${shortDate(s.lastMonthly.dealDate)} · 보증금/월세(만원)`
                  : '기록 없음'}
              </div>
            </div>
            <div className="tile">
              <div className="label">3년 신고 건수</div>
              <div className="value tabular">
                {s?.jeonseCount ?? 0}
                <span style={{ fontSize: 13, fontWeight: 500 }}> / {s?.monthlyCount ?? 0}</span>
              </div>
              <div className="foot">전세 / 월세</div>
            </div>
            <div className="tile">
              <div className="label">유효 표본</div>
              <div className="value tabular">{s?.jeonseSamples ?? 0}</div>
              <div className="foot">전세 추정 기준</div>
            </div>
          </div>

          <button
            className="btn btn-ghost"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            style={{ width: '100%', marginTop: 14 }}
          >
            전월세 내역 표로 보기 ({data.rents.length}건) {open ? '▲' : '▼'}
          </button>

          {open && (
            <div className="table-scroll" style={{ marginTop: 12 }}>
              <table className="data">
                <caption className="sr-only">최근 3년 전월세 신고 내역</caption>
                <thead>
                  <tr>
                    <th scope="col">계약일</th>
                    <th scope="col">유형</th>
                    <th scope="col">전용면적</th>
                    <th scope="col">층</th>
                    <th scope="col">보증금</th>
                    <th scope="col">월세</th>
                    <th scope="col">계약기간</th>
                    <th scope="col">구분</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rents.map((r, i) => (
                    <tr key={`${r.dealDate}-${r.floor}-${r.deposit}-${r.monthlyRent}-${i}`}>
                      <td>{r.dealDate}</td>
                      <td>{r.monthlyRent === 0 ? '전세' : '월세'}</td>
                      <td>
                        {r.area}㎡ ({pyeong(r.area)}평)
                      </td>
                      <td>{r.floor ?? '—'}</td>
                      <td>{krw(r.deposit)}</td>
                      <td>{r.monthlyRent === 0 ? '—' : `${r.monthlyRent.toLocaleString('ko-KR')}만`}</td>
                      <td>{r.contractTerm ?? '—'}</td>
                      <td>
                        {r.contractType ?? '—'}
                        {r.useRRRight ? ` · 갱신권 ${r.useRRRight}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <ul className="notes">
            <li>
              전세가율은 <b>같은 평형의 전세 추정 ÷ 매매 추정</b>입니다. 두 추정 모두 오차가
              있으니 비율도 그만큼 흔들립니다.
            </li>
            <li>
              보증금이 있는 월세(반전세)는 월세로 분류했습니다. 표에서 보증금/월세를 같이
              확인하세요.
            </li>
            {data.meta.mode === 'memory' && (
              <li className="muted">메모리 캐시 모드 — Supabase 를 붙이면 빨라집니다.</li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}
