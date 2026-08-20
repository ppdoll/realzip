'use client';

import { useState } from 'react';
import type { Trade } from '@/lib/types';
import { krw, pyeong } from '@/lib/format';
import { PYEONG } from '@/lib/stats';

/** 차트의 대체 표현(table view) — 색에 의존하지 않고 값 자체를 읽을 수 있게 한다. */
export default function TradeTable({ trades }: { trades: Trade[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="card">
      <button
        className="btn btn-ghost"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ width: '100%', justifyContent: 'space-between' }}
      >
        실거래 내역 표로 보기 ({trades.length}건) {open ? '▲' : '▼'}
      </button>

      {open && (
        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table className="data">
            <caption className="sr-only">최근 3년 실거래 신고 내역</caption>
            <thead>
              <tr>
                <th scope="col">계약일</th>
                <th scope="col">유형</th>
                <th scope="col">전용면적</th>
                <th scope="col">층</th>
                <th scope="col">거래금액</th>
                <th scope="col">평단가</th>
                <th scope="col">등기일</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <tr key={`${t.dealDate}-${t.floor}-${t.amount}-${i}`} className={t.canceled ? 'canceled' : ''}>
                  <td>{t.dealDate}</td>
                  <td>
                    {t.dealingGbn ?? '—'}
                    {t.canceled ? ' (해제)' : ''}
                  </td>
                  <td>
                    {t.area}㎡ ({pyeong(t.area)}평)
                  </td>
                  <td>{t.floor ?? '—'}</td>
                  <td>{krw(t.amount)}</td>
                  <td>{Math.round((t.amount / t.area) * PYEONG).toLocaleString('ko-KR')}</td>
                  <td>{t.rgstDate ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
