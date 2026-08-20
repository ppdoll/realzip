import AppShell from '@/components/AppShell';
import { regionsBySido } from '@/data/regions';

export default function Home() {
  return <AppShell sidoList={regionsBySido()} />;
}
