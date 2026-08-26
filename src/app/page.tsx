import AppShell from '@/components/AppShell';
import RegionLinks from '@/components/RegionLinks';
import { regionsBySido } from '@/data/regions';

export default function Home() {
  return (
    <>
      <AppShell sidoList={regionsBySido()} />
      {/*
        지역 페이지로 가는 입구. 크롤러는 링크를 따라 걷기 때문에 사이트맵만으로는
        발견이 느리고 페이지 사이 관계도 읽히지 않는다.
      */}
      <div className="page" style={{ paddingTop: 0 }}>
        <RegionLinks />
      </div>
    </>
  );
}
