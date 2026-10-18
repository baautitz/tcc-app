import type { Section } from "./SectionLayout";
import { PermissionsSection } from "@/modules/identity/pages/PermissionsSection";
import { QueriesSection } from "./queries/QueriesSection";
import { SourcesSection } from "./sources/SourcesSection";
import { UsersSection } from "@/modules/identity/pages/UsersSection";

const sections = {
  users: UsersSection,
  permissions: PermissionsSection,
  sources: SourcesSection,
  queries: QueriesSection,
};

export function AdminSectionPage({ section }: { section: Section }) {
  const Content = sections[section];
  return <Content />;
}
