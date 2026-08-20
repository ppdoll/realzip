/**
 * 법정동코드 시군구(5자리) 목록 — 국토부 실거래가 API의 `LAWD_CD` 파라미터 값.
 *
 * 출처: 행정표준코드관리시스템(code.go.kr) 법정동코드 전체자료.
 * 일반구가 있는 시(수원/성남/고양/용인/창원/청주/천안 등)는 시 코드가 아니라
 * **구 단위 코드**를 써야 실거래 데이터가 나온다.
 *
 * 코드가 개편된 지역(강원 42→51, 전북 45→52)은 legacy에 구 코드를 적어두었고,
 * API가 빈 응답을 주면 lib/molit.ts 가 자동으로 legacy 코드로 재시도한다.
 *
 * 목록이 낡았다고 판단되면 `npm run sync:regions`(공식 API로 재생성) 또는
 * `npm run probe`(전체 코드 유효성 점검)를 실행할 것.
 */
export type Region = {
  /** 법정동코드 앞 5자리 */
  code: string;
  /** 시/도 */
  sido: string;
  /** 시군구 (일반구가 있으면 "수원시 영통구" 형태) */
  name: string;
  /** 코드 개편 전 구 코드 (있으면 빈 응답 시 폴백) */
  legacy?: string;
};

export const REGIONS: Region[] = [
  // ── 서울특별시 ──────────────────────────────────────────────
  { code: '11110', sido: '서울특별시', name: '종로구' },
  { code: '11140', sido: '서울특별시', name: '중구' },
  { code: '11170', sido: '서울특별시', name: '용산구' },
  { code: '11200', sido: '서울특별시', name: '성동구' },
  { code: '11215', sido: '서울특별시', name: '광진구' },
  { code: '11230', sido: '서울특별시', name: '동대문구' },
  { code: '11260', sido: '서울특별시', name: '중랑구' },
  { code: '11290', sido: '서울특별시', name: '성북구' },
  { code: '11305', sido: '서울특별시', name: '강북구' },
  { code: '11320', sido: '서울특별시', name: '도봉구' },
  { code: '11350', sido: '서울특별시', name: '노원구' },
  { code: '11380', sido: '서울특별시', name: '은평구' },
  { code: '11410', sido: '서울특별시', name: '서대문구' },
  { code: '11440', sido: '서울특별시', name: '마포구' },
  { code: '11470', sido: '서울특별시', name: '양천구' },
  { code: '11500', sido: '서울특별시', name: '강서구' },
  { code: '11530', sido: '서울특별시', name: '구로구' },
  { code: '11545', sido: '서울특별시', name: '금천구' },
  { code: '11560', sido: '서울특별시', name: '영등포구' },
  { code: '11590', sido: '서울특별시', name: '동작구' },
  { code: '11620', sido: '서울특별시', name: '관악구' },
  { code: '11650', sido: '서울특별시', name: '서초구' },
  { code: '11680', sido: '서울특별시', name: '강남구' },
  { code: '11710', sido: '서울특별시', name: '송파구' },
  { code: '11740', sido: '서울특별시', name: '강동구' },

  // ── 부산광역시 ──────────────────────────────────────────────
  { code: '26110', sido: '부산광역시', name: '중구' },
  { code: '26140', sido: '부산광역시', name: '서구' },
  { code: '26170', sido: '부산광역시', name: '동구' },
  { code: '26200', sido: '부산광역시', name: '영도구' },
  { code: '26230', sido: '부산광역시', name: '부산진구' },
  { code: '26260', sido: '부산광역시', name: '동래구' },
  { code: '26290', sido: '부산광역시', name: '남구' },
  { code: '26320', sido: '부산광역시', name: '북구' },
  { code: '26350', sido: '부산광역시', name: '해운대구' },
  { code: '26380', sido: '부산광역시', name: '사하구' },
  { code: '26410', sido: '부산광역시', name: '금정구' },
  { code: '26440', sido: '부산광역시', name: '강서구' },
  { code: '26470', sido: '부산광역시', name: '연제구' },
  { code: '26500', sido: '부산광역시', name: '수영구' },
  { code: '26530', sido: '부산광역시', name: '사상구' },
  { code: '26710', sido: '부산광역시', name: '기장군' },

  // ── 대구광역시 ──────────────────────────────────────────────
  { code: '27110', sido: '대구광역시', name: '중구' },
  { code: '27140', sido: '대구광역시', name: '동구' },
  { code: '27170', sido: '대구광역시', name: '서구' },
  { code: '27200', sido: '대구광역시', name: '남구' },
  { code: '27230', sido: '대구광역시', name: '북구' },
  { code: '27260', sido: '대구광역시', name: '수성구' },
  { code: '27290', sido: '대구광역시', name: '달서구' },
  { code: '27710', sido: '대구광역시', name: '달성군' },
  { code: '27720', sido: '대구광역시', name: '군위군' },

  // ── 인천광역시 ──────────────────────────────────────────────
  { code: '28110', sido: '인천광역시', name: '중구' },
  { code: '28140', sido: '인천광역시', name: '동구' },
  { code: '28177', sido: '인천광역시', name: '미추홀구', legacy: '28150' },
  { code: '28185', sido: '인천광역시', name: '연수구' },
  { code: '28200', sido: '인천광역시', name: '남동구' },
  { code: '28237', sido: '인천광역시', name: '부평구' },
  { code: '28245', sido: '인천광역시', name: '계양구' },
  { code: '28260', sido: '인천광역시', name: '서구' },
  { code: '28710', sido: '인천광역시', name: '강화군' },
  { code: '28720', sido: '인천광역시', name: '옹진군' },

  // ── 광주광역시 ──────────────────────────────────────────────
  { code: '29110', sido: '광주광역시', name: '동구' },
  { code: '29140', sido: '광주광역시', name: '서구' },
  { code: '29155', sido: '광주광역시', name: '남구' },
  { code: '29170', sido: '광주광역시', name: '북구' },
  { code: '29200', sido: '광주광역시', name: '광산구' },

  // ── 대전광역시 ──────────────────────────────────────────────
  { code: '30110', sido: '대전광역시', name: '동구' },
  { code: '30140', sido: '대전광역시', name: '중구' },
  { code: '30170', sido: '대전광역시', name: '서구' },
  { code: '30200', sido: '대전광역시', name: '유성구' },
  { code: '30230', sido: '대전광역시', name: '대덕구' },

  // ── 울산광역시 ──────────────────────────────────────────────
  { code: '31110', sido: '울산광역시', name: '중구' },
  { code: '31140', sido: '울산광역시', name: '남구' },
  { code: '31170', sido: '울산광역시', name: '동구' },
  { code: '31200', sido: '울산광역시', name: '북구' },
  { code: '31710', sido: '울산광역시', name: '울주군' },

  // ── 세종특별자치시 ──────────────────────────────────────────
  { code: '36110', sido: '세종특별자치시', name: '세종시' },

  // ── 경기도 ──────────────────────────────────────────────────
  { code: '41111', sido: '경기도', name: '수원시 장안구' },
  { code: '41113', sido: '경기도', name: '수원시 권선구' },
  { code: '41115', sido: '경기도', name: '수원시 팔달구' },
  { code: '41117', sido: '경기도', name: '수원시 영통구' },
  { code: '41131', sido: '경기도', name: '성남시 수정구' },
  { code: '41133', sido: '경기도', name: '성남시 중원구' },
  { code: '41135', sido: '경기도', name: '성남시 분당구' },
  { code: '41150', sido: '경기도', name: '의정부시' },
  { code: '41171', sido: '경기도', name: '안양시 만안구' },
  { code: '41173', sido: '경기도', name: '안양시 동안구' },
  { code: '41190', sido: '경기도', name: '부천시' },
  { code: '41210', sido: '경기도', name: '광명시' },
  { code: '41220', sido: '경기도', name: '평택시' },
  { code: '41250', sido: '경기도', name: '동두천시' },
  { code: '41271', sido: '경기도', name: '안산시 상록구' },
  { code: '41273', sido: '경기도', name: '안산시 단원구' },
  { code: '41281', sido: '경기도', name: '고양시 덕양구' },
  { code: '41285', sido: '경기도', name: '고양시 일산동구' },
  { code: '41287', sido: '경기도', name: '고양시 일산서구' },
  { code: '41290', sido: '경기도', name: '과천시' },
  { code: '41310', sido: '경기도', name: '구리시' },
  { code: '41360', sido: '경기도', name: '남양주시' },
  { code: '41370', sido: '경기도', name: '오산시' },
  { code: '41390', sido: '경기도', name: '시흥시' },
  { code: '41410', sido: '경기도', name: '군포시' },
  { code: '41430', sido: '경기도', name: '의왕시' },
  { code: '41450', sido: '경기도', name: '하남시' },
  { code: '41461', sido: '경기도', name: '용인시 처인구' },
  { code: '41463', sido: '경기도', name: '용인시 기흥구' },
  { code: '41465', sido: '경기도', name: '용인시 수지구' },
  { code: '41480', sido: '경기도', name: '파주시' },
  { code: '41500', sido: '경기도', name: '이천시' },
  { code: '41550', sido: '경기도', name: '안성시' },
  { code: '41570', sido: '경기도', name: '김포시' },
  { code: '41590', sido: '경기도', name: '화성시' },
  { code: '41610', sido: '경기도', name: '광주시' },
  { code: '41630', sido: '경기도', name: '양주시' },
  { code: '41650', sido: '경기도', name: '포천시' },
  { code: '41670', sido: '경기도', name: '여주시' },
  { code: '41800', sido: '경기도', name: '연천군' },
  { code: '41820', sido: '경기도', name: '가평군' },
  { code: '41830', sido: '경기도', name: '양평군' },

  // ── 강원특별자치도 (2023.6 코드 42 → 51) ────────────────────
  { code: '51110', sido: '강원특별자치도', name: '춘천시', legacy: '42110' },
  { code: '51130', sido: '강원특별자치도', name: '원주시', legacy: '42130' },
  { code: '51150', sido: '강원특별자치도', name: '강릉시', legacy: '42150' },
  { code: '51170', sido: '강원특별자치도', name: '동해시', legacy: '42170' },
  { code: '51190', sido: '강원특별자치도', name: '태백시', legacy: '42190' },
  { code: '51210', sido: '강원특별자치도', name: '속초시', legacy: '42210' },
  { code: '51230', sido: '강원특별자치도', name: '삼척시', legacy: '42230' },
  { code: '51720', sido: '강원특별자치도', name: '홍천군', legacy: '42720' },
  { code: '51730', sido: '강원특별자치도', name: '횡성군', legacy: '42730' },
  { code: '51750', sido: '강원특별자치도', name: '영월군', legacy: '42750' },
  { code: '51760', sido: '강원특별자치도', name: '평창군', legacy: '42760' },
  { code: '51770', sido: '강원특별자치도', name: '정선군', legacy: '42770' },
  { code: '51780', sido: '강원특별자치도', name: '철원군', legacy: '42780' },
  { code: '51790', sido: '강원특별자치도', name: '화천군', legacy: '42790' },
  { code: '51800', sido: '강원특별자치도', name: '양구군', legacy: '42800' },
  { code: '51810', sido: '강원특별자치도', name: '인제군', legacy: '42810' },
  { code: '51820', sido: '강원특별자치도', name: '고성군', legacy: '42820' },
  { code: '51830', sido: '강원특별자치도', name: '양양군', legacy: '42830' },

  // ── 충청북도 ────────────────────────────────────────────────
  { code: '43111', sido: '충청북도', name: '청주시 상당구' },
  { code: '43112', sido: '충청북도', name: '청주시 서원구' },
  { code: '43113', sido: '충청북도', name: '청주시 흥덕구' },
  { code: '43114', sido: '충청북도', name: '청주시 청원구' },
  { code: '43130', sido: '충청북도', name: '충주시' },
  { code: '43150', sido: '충청북도', name: '제천시' },
  { code: '43720', sido: '충청북도', name: '보은군' },
  { code: '43730', sido: '충청북도', name: '옥천군' },
  { code: '43740', sido: '충청북도', name: '영동군' },
  { code: '43745', sido: '충청북도', name: '증평군' },
  { code: '43750', sido: '충청북도', name: '진천군' },
  { code: '43760', sido: '충청북도', name: '괴산군' },
  { code: '43770', sido: '충청북도', name: '음성군' },
  { code: '43800', sido: '충청북도', name: '단양군' },

  // ── 충청남도 ────────────────────────────────────────────────
  { code: '44131', sido: '충청남도', name: '천안시 동남구' },
  { code: '44133', sido: '충청남도', name: '천안시 서북구' },
  { code: '44150', sido: '충청남도', name: '공주시' },
  { code: '44180', sido: '충청남도', name: '보령시' },
  { code: '44200', sido: '충청남도', name: '아산시' },
  { code: '44210', sido: '충청남도', name: '서산시' },
  { code: '44230', sido: '충청남도', name: '논산시' },
  { code: '44250', sido: '충청남도', name: '계룡시' },
  { code: '44270', sido: '충청남도', name: '당진시' },
  { code: '44710', sido: '충청남도', name: '금산군' },
  { code: '44760', sido: '충청남도', name: '부여군' },
  { code: '44770', sido: '충청남도', name: '서천군' },
  { code: '44790', sido: '충청남도', name: '청양군' },
  { code: '44800', sido: '충청남도', name: '홍성군' },
  { code: '44810', sido: '충청남도', name: '예산군' },
  { code: '44825', sido: '충청남도', name: '태안군' },

  // ── 전북특별자치도 (2024.1 코드 45 → 52) ────────────────────
  { code: '52111', sido: '전북특별자치도', name: '전주시 완산구', legacy: '45111' },
  { code: '52113', sido: '전북특별자치도', name: '전주시 덕진구', legacy: '45113' },
  { code: '52130', sido: '전북특별자치도', name: '군산시', legacy: '45130' },
  { code: '52140', sido: '전북특별자치도', name: '익산시', legacy: '45140' },
  { code: '52180', sido: '전북특별자치도', name: '정읍시', legacy: '45180' },
  { code: '52190', sido: '전북특별자치도', name: '남원시', legacy: '45190' },
  { code: '52210', sido: '전북특별자치도', name: '김제시', legacy: '45210' },
  { code: '52710', sido: '전북특별자치도', name: '완주군', legacy: '45710' },
  { code: '52720', sido: '전북특별자치도', name: '진안군', legacy: '45720' },
  { code: '52730', sido: '전북특별자치도', name: '무주군', legacy: '45730' },
  { code: '52740', sido: '전북특별자치도', name: '장수군', legacy: '45740' },
  { code: '52750', sido: '전북특별자치도', name: '임실군', legacy: '45750' },
  { code: '52770', sido: '전북특별자치도', name: '순창군', legacy: '45770' },
  { code: '52790', sido: '전북특별자치도', name: '고창군', legacy: '45790' },
  { code: '52800', sido: '전북특별자치도', name: '부안군', legacy: '45800' },

  // ── 전라남도 ────────────────────────────────────────────────
  { code: '46110', sido: '전라남도', name: '목포시' },
  { code: '46130', sido: '전라남도', name: '여수시' },
  { code: '46150', sido: '전라남도', name: '순천시' },
  { code: '46170', sido: '전라남도', name: '나주시' },
  { code: '46230', sido: '전라남도', name: '광양시' },
  { code: '46710', sido: '전라남도', name: '담양군' },
  { code: '46720', sido: '전라남도', name: '곡성군' },
  { code: '46730', sido: '전라남도', name: '구례군' },
  { code: '46770', sido: '전라남도', name: '고흥군' },
  { code: '46780', sido: '전라남도', name: '보성군' },
  { code: '46790', sido: '전라남도', name: '화순군' },
  { code: '46800', sido: '전라남도', name: '장흥군' },
  { code: '46810', sido: '전라남도', name: '강진군' },
  { code: '46820', sido: '전라남도', name: '해남군' },
  { code: '46830', sido: '전라남도', name: '영암군' },
  { code: '46840', sido: '전라남도', name: '무안군' },
  { code: '46860', sido: '전라남도', name: '함평군' },
  { code: '46870', sido: '전라남도', name: '영광군' },
  { code: '46880', sido: '전라남도', name: '장성군' },
  { code: '46890', sido: '전라남도', name: '완도군' },
  { code: '46900', sido: '전라남도', name: '진도군' },
  { code: '46910', sido: '전라남도', name: '신안군' },

  // ── 경상북도 ────────────────────────────────────────────────
  { code: '47110', sido: '경상북도', name: '포항시 남구' },
  { code: '47130', sido: '경상북도', name: '포항시 북구' },
  { code: '47150', sido: '경상북도', name: '경주시' },
  { code: '47170', sido: '경상북도', name: '김천시' },
  { code: '47190', sido: '경상북도', name: '안동시' },
  { code: '47210', sido: '경상북도', name: '구미시' },
  { code: '47230', sido: '경상북도', name: '영주시' },
  { code: '47250', sido: '경상북도', name: '영천시' },
  { code: '47280', sido: '경상북도', name: '상주시' },
  { code: '47290', sido: '경상북도', name: '문경시' },
  { code: '47730', sido: '경상북도', name: '경산시' },
  { code: '47750', sido: '경상북도', name: '의성군' },
  { code: '47760', sido: '경상북도', name: '청송군' },
  { code: '47770', sido: '경상북도', name: '영양군' },
  { code: '47820', sido: '경상북도', name: '영덕군' },
  { code: '47830', sido: '경상북도', name: '청도군' },
  { code: '47840', sido: '경상북도', name: '고령군' },
  { code: '47850', sido: '경상북도', name: '성주군' },
  { code: '47900', sido: '경상북도', name: '칠곡군' },
  { code: '47920', sido: '경상북도', name: '예천군' },
  { code: '47930', sido: '경상북도', name: '봉화군' },
  { code: '47940', sido: '경상북도', name: '울진군' },
  { code: '47950', sido: '경상북도', name: '울릉군' },

  // ── 경상남도 ────────────────────────────────────────────────
  { code: '48121', sido: '경상남도', name: '창원시 의창구' },
  { code: '48123', sido: '경상남도', name: '창원시 성산구' },
  { code: '48125', sido: '경상남도', name: '창원시 마산합포구' },
  { code: '48127', sido: '경상남도', name: '창원시 마산회원구' },
  { code: '48129', sido: '경상남도', name: '창원시 진해구' },
  { code: '48170', sido: '경상남도', name: '진주시' },
  { code: '48220', sido: '경상남도', name: '통영시' },
  { code: '48240', sido: '경상남도', name: '사천시' },
  { code: '48250', sido: '경상남도', name: '김해시' },
  { code: '48270', sido: '경상남도', name: '밀양시' },
  { code: '48310', sido: '경상남도', name: '거제시' },
  { code: '48330', sido: '경상남도', name: '양산시' },
  { code: '48720', sido: '경상남도', name: '의령군' },
  { code: '48730', sido: '경상남도', name: '함안군' },
  { code: '48740', sido: '경상남도', name: '창녕군' },
  { code: '48820', sido: '경상남도', name: '고성군' },
  { code: '48840', sido: '경상남도', name: '남해군' },
  { code: '48850', sido: '경상남도', name: '하동군' },
  { code: '48860', sido: '경상남도', name: '산청군' },
  { code: '48870', sido: '경상남도', name: '함양군' },
  { code: '48880', sido: '경상남도', name: '거창군' },
  { code: '48890', sido: '경상남도', name: '합천군' },

  // ── 제주특별자치도 ──────────────────────────────────────────
  { code: '50110', sido: '제주특별자치도', name: '제주시' },
  { code: '50130', sido: '제주특별자치도', name: '서귀포시' },
];

export const REGION_BY_CODE = new Map(REGIONS.map((r) => [r.code, r]));

export function regionLabel(code: string): string {
  const r = REGION_BY_CODE.get(code);
  return r ? `${r.sido} ${r.name}` : code;
}

/** 시/도별로 묶은 목록 (셀렉트 박스용) */
export function regionsBySido(): { sido: string; regions: Region[] }[] {
  const order: string[] = [];
  const map = new Map<string, Region[]>();
  for (const r of REGIONS) {
    if (!map.has(r.sido)) {
      map.set(r.sido, []);
      order.push(r.sido);
    }
    map.get(r.sido)!.push(r);
  }
  return order.map((sido) => ({ sido, regions: map.get(sido)! }));
}
