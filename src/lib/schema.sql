-- ─────────────────────────────────────────────────────────────────────────
--  Supabase SQL Editor 에 그대로 붙여 실행하세요.
--  (Supabase 를 쓰지 않으면 이 파일은 무시해도 됩니다 — 메모리 캐시로 동작합니다.)
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists apt_trade (
  -- aptSeq|계약일|전용면적|층|금액 (+ 동일 신고가 여럿이면 #2, #3 접미).
  -- 적재는 (시군구, 계약년월) 단위 delete → insert 라 이 값은 그 달 안에서만 유일하면 된다.
  id          text primary key,
  lawd_cd     text        not null,
  deal_ym     text        not null,
  apt_seq     text        not null,
  apt_nm      text        not null,
  umd_nm      text,
  jibun       text,
  road_nm     text,
  build_year  int,
  area        numeric(9,4) not null,   -- 전용면적 m² (원본이 31.402 처럼 소수 3자리까지 온다)
  floor       int,
  deal_date   date        not null,    -- 계약일
  amount      int         not null,    -- 만원
  dealing_gbn text,                    -- 중개거래 / 직거래
  buyer_gbn   text,
  sler_gbn    text,
  canceled    boolean     not null default false,
  rgst_date   text,
  updated_at  timestamptz not null default now()
);

create index if not exists apt_trade_region_idx  on apt_trade (lawd_cd, deal_date desc);
create index if not exists apt_trade_complex_idx on apt_trade (apt_seq, deal_date desc);
create index if not exists apt_trade_name_idx    on apt_trade (lawd_cd, apt_nm);
create index if not exists apt_trade_ym_idx      on apt_trade (lawd_cd, deal_ym);

-- 어느 (시군구, 계약년월)을 언제 수집했는지. 같은 달을 반복 호출하지 않기 위한 장부.
create table if not exists ingest_log (
  lawd_cd    text        not null,
  deal_ym    text        not null,
  rows       int         not null default 0,
  fetched_at timestamptz not null default now(),
  primary key (lawd_cd, deal_ym)
);

-- ── 전월세 ────────────────────────────────────────────────────────────────
-- 전월세 API 에는 aptSeq 가 없어서 단지 매칭을 (법정동+단지명+지번) 으로 한다.
create table if not exists apt_rent (
  -- 법정동|단지명|지번|계약일|전용면적|층|보증금|월세 (+ 동일 신고 여럿이면 #2, #3)
  id             text primary key,
  lawd_cd        text        not null,
  deal_ym        text        not null,
  umd_nm         text        not null,
  apt_nm         text        not null,
  jibun          text,
  build_year     int,
  area           numeric(9,4) not null,   -- 전용면적 m²
  floor          int,
  deal_date      date        not null,    -- 계약일
  deposit        int         not null,    -- 보증금 (만원)
  monthly_rent   int         not null default 0,  -- 월세 (만원). 0 이면 전세
  contract_term  text,
  contract_type  text,
  pre_deposit    int,
  pre_monthly_rent int,
  use_rr_right   text,
  updated_at     timestamptz not null default now()
);

create index if not exists apt_rent_region_idx on apt_rent (lawd_cd, deal_date desc);
create index if not exists apt_rent_name_idx   on apt_rent (lawd_cd, apt_nm);
create index if not exists apt_rent_ym_idx     on apt_rent (lawd_cd, deal_ym);

create table if not exists rent_ingest_log (
  lawd_cd    text        not null,
  deal_ym    text        not null,
  rows       int         not null default 0,
  fetched_at timestamptz not null default now(),
  primary key (lawd_cd, deal_ym)
);

-- ── 공동주택 단지 정보 (K-apt) ────────────────────────────────────────────
-- 실거래가와 조인 키가 없다. K-apt 는 kaptCode, 실거래가는 aptSeq 라서
-- **주소(법정동 + 지번)** 로 맞춘다 — 이름은 표기가 너무 갈려서 못 쓴다
-- ("THESHARP판교퍼스트파크" vs "더샵판교퍼스트파크", "까치마을(1단지)(대우롯데선경)" 등).
-- 조인율 실측(강남구): 거래 20건 이상 단지 79%, 5건 이상 63%.
-- K-apt 가 의무관리대상(300세대 이상 등)만 담기 때문에 소규모 단지는 애초에 없다.
create table if not exists apt_kapt (
  kapt_code    text primary key,
  lawd_cd      text not null,
  umd_nm       text not null,
  jibun        text,               -- 주소에서 뽑은 지번 (조인 키)
  kapt_name    text not null,
  addr         text,
  road_addr    text,
  households   int,                -- 세대수 (kaptdaCnt)
  dong_cnt     int,                -- 동수
  total_area   numeric(14,2),      -- 연면적 (kaptTarea)
  priv_area    numeric(14,2),      -- 전용면적 합 (privArea)
  use_date     text,               -- 사용승인일 YYYYMMDD
  heat_nm      text,               -- 난방방식 (지역/개별/중앙)
  hall_nm      text,               -- 복도식 / 계단식 / 혼합
  mgr_nm       text,               -- 위탁관리 / 자치관리
  sale_nm      text,               -- 분양 / 임대
  builder      text,               -- 시공사
  top_floor    int,
  elevator_cnt int,
  updated_at   timestamptz not null default now()
);

create index if not exists apt_kapt_join_idx on apt_kapt (lawd_cd, umd_nm, jibun);
create index if not exists apt_kapt_name_idx on apt_kapt (lawd_cd, kapt_name);

-- 어느 시군구의 단지 목록을 언제 받았는지 (단지 목록 1회 + 단지별 기본정보 N회)
create table if not exists kapt_ingest_log (
  lawd_cd    text primary key,
  complexes  int  not null default 0,
  fetched_at timestamptz not null default now()
);

-- 서버(service_role)에서만 접근하므로 RLS 를 켜고 정책은 두지 않는다.
alter table apt_trade       enable row level security;
alter table ingest_log      enable row level security;
alter table apt_rent        enable row level security;
alter table rent_ingest_log enable row level security;
alter table apt_kapt        enable row level security;
alter table kapt_ingest_log enable row level security;

-- 이미 numeric(8,2) 로 만들어 둔 경우에만 (전용면적 소수 3자리 보존):
--   alter table apt_trade alter column area type numeric(9,4);
