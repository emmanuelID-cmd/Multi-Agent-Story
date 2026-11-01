import Workspace from "../workspace";

type Props = {
  params: Promise<{ workId: string }>;
};

export default async function WorkPage({ params }: Props) {
  const { workId } = await params;
  return <Workspace workId={workId} />;
}
