import type { Section } from "./SectionLayout";
import { PermissionsSection } from "./permissions/PermissionsSection";
import { QueriesSection } from "./queries/QueriesSection";
import { SourcesSection } from "./sources/SourcesSection";
import { UsersSection } from "./users/UsersSection";

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
