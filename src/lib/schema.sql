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
  -- 건물 종류 (아파트 / 주상복합 / 연립주택 …). 회전율이 유난히 높은 단지를 보면
  -- 주상복합이 섞여 있어서, 값 자체보다 "왜 그런지" 를 설명하는 데 쓴다.
  apt_kind     text,
  -- 세대 규모 구성 (전용면적 기준 세대수). 청약·세금이 쓰는 60·85·135㎡ 구간이다.
  -- 방 수가 공공데이터에 없어서 단지 성격을 보여줄 대안으로 담는다 —
  -- "2,100세대 전부 60㎡ 이하" 는 원룸형·소형 단지라는 뜻이고,
  -- 전세가율 100% 넘는 이상치들이 대개 여기에 몰려 있다.
  units_60     int,
  units_85     int,
  units_135    int,
  units_over   int,
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

-- 이미 만들어 둔 apt_kapt 에 컬럼을 붙인다 (create table if not exists 는 컬럼을 추가하지 않는다)
alter table apt_kapt add column if not exists apt_kind  text;
alter table apt_kapt add column if not exists units_60  int;
alter table apt_kapt add column if not exists units_85  int;
alter table apt_kapt add column if not exists units_135 int;
alter table apt_kapt add column if not exists units_over int;

-- 서버(service_role)에서만 접근하므로 RLS 를 켜고 정책은 두지 않는다.
alter table apt_trade       enable row level security;
alter table ingest_log      enable row level security;
alter table apt_rent        enable row level security;
alter table rent_ingest_log enable row level security;
alter table apt_kapt        enable row level security;
alter table kapt_ingest_log enable row level security;

-- 이미 numeric(8,2) 로 만들어 둔 경우에만 (전용면적 소수 3자리 보존):
--   alter table apt_trade alter column area type numeric(9,4);

-- ──────────────────────────────────────────────────────────────────────────
--  조건 검색 (지역 · 평형 · 금액) — DB 안에서 집계한다
-- ──────────────────────────────────────────────────────────────────────────
--
-- 노드로 끌어와서 집계하면 못 쓴다. 실측: 63개 지역 · 최근 1년 · 15~50평 ·
-- 3~20억 조건이 175,280행 18.1초였다 (20~30평 5~8억도 36,631행 6.5초).
-- 여기서 필요한 건 단지·평형별 중위값 한 줄씩이라, 그 집계를 DB 에 맡기면
-- 넘어오는 건 수백 줄로 줄어든다.
--
-- 금액 조건은 **개별 거래가 아니라 단지·평형의 중위값**에 건다. 거래를 먼저
-- 금액으로 걸러내고 중위를 내면, 싼 거래 한 건 때문에 들어온 단지의 중위가
-- 조건 구간 안으로 끌려 들어가서 실제 시세를 잘못 보여준다.
--
-- security definer 를 쓰지 않는다. RLS 가 켜져 있고 정책이 없으므로 anon 키로
-- 부르면 0행이 나오고, 서버의 secret 키로 부를 때만 값이 나온다.
-- 반환 컬럼이 바뀌면 create or replace 가 거부하므로 먼저 지운다.
-- 함수는 상태가 없어서 여러 번 지우고 만들어도 안전하다.
drop function if exists search_complexes(
  text[], text, numeric, numeric, int, int, int, text, int, int
);
drop function if exists search_complexes(
  text[], text, numeric, numeric, int, int, int, int, int, text, int, int
);

create or replace function search_complexes(
  p_lawd_cds  text[],
  p_from_ym   text,
  p_area_min  numeric,
  p_area_max  numeric,
  p_price_min int,
  p_price_max int,
  p_min_deals int  default 1,
  -- 준공년도 범위. null 이면 제한 없음.
  -- 실거래 신고의 건축년도를 쓴다 — 최근 1년 거래 단지 11,677곳 중 빠진 값이 0 이라
  -- 조건을 걸어도 조용히 사라지는 단지가 없다. (K-apt 사용승인 연도와 98.05% 일치)
  p_year_min  int  default null,
  p_year_max  int  default null,
  p_sort      text default 'price_asc',
  p_limit     int  default 300,
  p_offset    int  default 0
)
returns table (
  lawd_cd    text,
  apt_seq    text,
  apt_nm     text,
  umd_nm     text,
  build_year int,
  area       numeric,
  area_min   numeric,
  area_max   numeric,
  price      int,
  deal_count int,
  min_amount int,
  max_amount int,
  last_deal  date,
  total_rows bigint
)
language sql
stable
as $$
  with base as (
    select t.lawd_cd, t.apt_seq, t.apt_nm, t.umd_nm, t.build_year, t.area, t.amount, t.deal_date
    from apt_trade t
    where t.lawd_cd = any(p_lawd_cds)
      and t.deal_ym >= p_from_ym
      and t.canceled = false
      and t.area >= p_area_min
      and t.area <= p_area_max
  ),
  -- 같은 단지 안에서 서로 1.5㎡ 이내인 면적은 한 타입으로 묶는다.
  -- 정수 ㎡ 로 반올림하면 0.2㎡ 차이가 경계를 넘어 갈린다 — 실측으로
  -- 하이파크시티일산파밀리에2단지가 121.45㎡(20건) 와 121.66㎡(10건) 로
  -- 쪼개져 화면에 같은 36.8평 두 줄로 나왔다. 84.44 / 84.57 도 같은 문제다.
  -- 6개 지역 24,513건으로 재보니 정수 반올림은 236쌍을 잘못 쪼갰고,
  -- 이 방식은 폭이 1.5㎡ 를 넘는 묶음이 20개(3㎡ 초과 3개) 남는다.
  -- 1.5㎡ 는 상세 화면이 "같은 평형" 으로 쓰는 기준과 같다.
  areas as (
    select distinct lawd_cd, apt_seq, area from base
  ),
  marked as (
    select lawd_cd, apt_seq, area,
      case
        when area - lag(area) over (partition by lawd_cd, apt_seq order by area) > 1.5 then 1
        else 0
      end as brk
    from areas
  ),
  clustered as (
    select lawd_cd, apt_seq, area,
      sum(brk) over (
        partition by lawd_cd, apt_seq order by area
        rows between unbounded preceding and current row
      ) as cid
    from marked
  ),
  grouped as (
    select
      b.lawd_cd,
      b.apt_seq,
      c.cid,
      min(b.apt_nm)                                            as apt_nm,
      min(b.umd_nm)                                            as umd_nm,
      max(b.build_year)                                        as build_year,
      round(avg(b.area), 1)                                    as area,
      round(min(b.area), 1)                                    as area_min,
      round(max(b.area), 1)                                    as area_max,
      percentile_cont(0.5) within group (order by b.amount)::int as price,
      count(*)::int                                            as deal_count,
      min(b.amount)::int                                       as min_amount,
      max(b.amount)::int                                       as max_amount,
      max(b.deal_date)                                         as last_deal
    from base b
    join clustered c
      on c.lawd_cd = b.lawd_cd and c.apt_seq = b.apt_seq and c.area = b.area
    group by b.lawd_cd, b.apt_seq, c.cid
  ),
  filtered as (
    select * from grouped
    where price between p_price_min and p_price_max
      and deal_count >= p_min_deals
      -- 준공년도는 **묶은 뒤** 거른다. 화면에 보이는 값과 조건이 같은 값이어야 한다.
      and (p_year_min is null or build_year >= p_year_min)
      and (p_year_max is null or build_year <= p_year_max)
  )
  select
    f.lawd_cd, f.apt_seq, f.apt_nm, f.umd_nm, f.build_year,
    f.area, f.area_min, f.area_max,
    f.price, f.deal_count, f.min_amount, f.max_amount, f.last_deal,
    count(*) over () as total_rows
  from filtered f
  order by
    case when p_sort = 'price_asc'  then f.price                                    end asc,
    case when p_sort = 'price_desc' then f.price                                    end desc,
    case when p_sort = 'ppa_asc'    then f.price::numeric / nullif(f.area, 0)        end asc,
    case when p_sort = 'ppa_desc'   then f.price::numeric / nullif(f.area, 0)        end desc,
    case when p_sort = 'deals_desc' then f.deal_count                               end desc,
    case when p_sort = 'recent'     then f.last_deal                                end desc,
    -- 마지막 세 줄은 동순위 정리용이다. 전순서가 아니면 offset 페이지에서
    -- 같은 줄이 두 번 오거나 빠진다.
    f.price asc, f.apt_seq asc, f.area asc
  limit greatest(p_limit, 1) offset greatest(p_offset, 0)
$$;

-- ──────────────────────────────────────────────────────────────────────────
--  지역 장기 가격지수 — 원본 거래를 안 들고도 10년 흐름을 보여준다
-- ──────────────────────────────────────────────────────────────────────────
--
-- 10년치 원본을 담으면 매매만 약 2,280,000행 850MB 라 무료 티어(500MB)의 두 배다.
-- 그런데 예상 시세는 최근성 반감기가 12개월이라 7년 전 거래의 가중치가 2^-84 ≈ 0 —
-- 850MB 를 더 써도 추정값은 그대로다. 10년이 실제로 쓸모 있는 곳은 **장기 흐름 차트**
-- 하나뿐이고, 그건 월별 요약만 있으면 그린다.
--
-- 76개 지역 × 120개월 = 9,120행. 원본의 0.4% 다.
--
-- 적재 방식: 국토부에서 그 달을 받아 **집계만 남기고 원본은 버린다**.
-- 그래서 이 표는 apt_trade 의 보관 창(36개월)과 무관하게 과거를 가진다.
create table if not exists region_index (
  lawd_cd   text not null,
  deal_ym   text not null,
  -- 전용 평당 만원 중위값. 평균이 아니라 중위인 이유는 한 달 안에 초고가 한 건이
  -- 섞여도 흔들리지 않아야 하기 때문이다.
  ppp_median numeric(12,2) not null,
  -- 사분위 — 그 달 가격이 얼마나 퍼져 있었는지 (차트 밴드용)
  ppp_p25    numeric(12,2),
  ppp_p75    numeric(12,2),
  deals      int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (lawd_cd, deal_ym)
);

create index if not exists region_index_ym_idx on region_index (lawd_cd, deal_ym);

alter table region_index enable row level security;
