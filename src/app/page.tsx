import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <p className="eyebrow">Sift</p>
      <h1>Потоковий імпорт великих файлів</h1>
      <p>Dashboard, NestJS API та worker ініціалізовані як окремі runtime-процеси.</p>
      <Link href="/imports">Перейти до імпортів</Link>
    </main>
  );
}
