import type { Section } from "@/shared/layout/SectionLayout";
import { PermissionsSection } from "@/modules/identity/pages/PermissionsSection";
import { QueriesSection } from "@/modules/queries/pages/QueriesSection";
import { SourcesSection } from "@/modules/data-sources/pages/SourcesSection";
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
