import { useMemo, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, Send } from "lucide-react";
import { Questionnaire } from "@shadcn/react/questionnaire";
import type { AiQuestionnaire } from "@/modules/ai/model/chat-sse";

export type QuestionnaireAnswers = Record<string, string[]>;

export type QuestionnaireChatItem = {
  id: string;
  toolCallId: string;
  kind: "questionnaire";
  questionnaire: AiQuestionnaire;
  ownerMessageId?: string;
  answers?: QuestionnaireAnswers;
  answersSent?: boolean;
};

export function QuestionnaireCard({
  item,
  busy,
  isLatestInteraction,
  onSubmit,
}: {
  item: QuestionnaireChatItem;
  busy: boolean;
  isLatestInteraction: boolean;
  onSubmit: (
    item: QuestionnaireChatItem,
    answers: QuestionnaireAnswers,
  ) => void;
}) {
  const definitions = useMemo(
    () =>
      item.questionnaire.questions.map((question) => ({
        name: question.name,
        required: question.required,
        choices: question.choices.map((choice) => ({ value: choice.value })),
      })),
    [item.questionnaire.questions],
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const answers = Object.fromEntries(
      item.questionnaire.questions.map((question) => [
        question.name,
        formData
          .getAll(question.name)
          .map(String)
          .filter((value) => value.trim()),
      ]),
    );
    onSubmit(item, answers);
  }

  return (
    <section
      aria-label="Perguntas para esclarecer o pedido"
      className="mx-3 flex min-w-0 flex-col gap-3 border border-primary/30 bg-primary/5 p-3 text-sm sm:mx-4"
    >
      <header>
        <h3 className="font-semibold">{item.questionnaire.title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {isLatestInteraction
            ? "Responda para a IA continuar. Ela aguardará suas escolhas antes de prosseguir."
            : "A conversa avançou; esta etapa não pode mais ser respondida."}
        </p>
      </header>

      {!item.answers && !isLatestInteraction ? (
        <p className="border-t border-primary/15 pt-3 text-xs text-muted-foreground">
          Esta pergunta foi substituída por uma mensagem mais recente.
        </p>
      ) : item.answers ? (
        <div className="space-y-2 border-t border-primary/15 pt-3">
          {item.questionnaire.questions.map((question) => {
            const answer = item.answers?.[question.name] ?? [];
            return (
              <div key={question.name}>
                <p className="text-xs font-medium">{question.prompt}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">
                  {answer.length ? answer.join(", ") : "Sem resposta"}
                </p>
              </div>
            );
          })}
          {item.answersSent ? (
            <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
              <Check className="size-3.5" /> Respostas enviadas para a IA.
            </p>
          ) : isLatestInteraction ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                O envio anterior não foi confirmado.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => onSubmit(item, item.answers ?? {})}
                className="inline-flex h-8 items-center border border-primary bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
              >
                Reenviar respostas
              </button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Esta pergunta foi substituída por uma mensagem mais recente.
            </p>
          )}
        </div>
      ) : (
        <Questionnaire.Root
          items={definitions}
          shortcuts="letters"
          onSubmit={submit}
          className="flex min-w-0 flex-col gap-3 border-t border-primary/15 pt-3"
        >
          <Questionnaire.Progress
            render={(_props, state) => (
              <div
                role="progressbar"
                aria-label="Progresso das perguntas"
                aria-valuemin={1}
                aria-valuemax={state.total}
                aria-valuenow={state.current}
                className="text-xs text-muted-foreground"
              >
                Pergunta {state.current} de {state.total}
              </div>
            )}
          />

          {item.questionnaire.questions.map((question) => (
            <Questionnaire.Item
              key={question.name}
              name={question.name}
              required={question.required}
              multiple={question.multiple}
              disabled={busy || !isLatestInteraction}
              className="min-w-0 space-y-1 border-0 p-0"
            >
              <Questionnaire.Title className="block text-sm font-medium">
                {question.prompt}
              </Questionnaire.Title>
              {question.description && (
                <Questionnaire.Description className="text-xs text-muted-foreground">
                  {question.description}
                </Questionnaire.Description>
              )}

              {(question.choices.length > 0 || question.allowOther) && (
                <Questionnaire.Choices className="mt-2 grid min-w-0 gap-2">
                  {question.choices.map((choice) => (
                    <Questionnaire.Choice
                      key={choice.value}
                      value={choice.value}
                      className="flex min-w-0 cursor-pointer items-start gap-2 border bg-background p-2.5 transition-colors hover:bg-muted/60 data-[checked]:border-primary data-[checked]:bg-primary/5 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60"
                    >
                      <Questionnaire.ChoiceInput className="mt-0.5 size-4 shrink-0 accent-primary" />
                      <span className="min-w-0">
                        <span className="block font-medium">
                          {choice.label}
                        </span>
                        {choice.description && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {choice.description}
                          </span>
                        )}
                      </span>
                    </Questionnaire.Choice>
                  ))}
                  {question.allowOther && (
                    <div className="border bg-background p-2.5">
                      <label
                        className="mb-1 block text-xs font-medium"
                        htmlFor={`questionnaire-other-${item.id}-${question.name}`}
                      >
                        {question.otherLabel}
                      </label>
                      <Questionnaire.Input
                        aria-label={question.otherLabel}
                        id={`questionnaire-other-${item.id}-${question.name}`}
                        placeholder={question.otherPlaceholder}
                        disabled={busy || !isLatestInteraction}
                        className="h-8 w-full border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
                      />
                    </div>
                  )}
                </Questionnaire.Choices>
              )}

              <Questionnaire.Error className="text-xs text-destructive">
                Selecione uma opção ou escreva uma resposta para continuar.
              </Questionnaire.Error>
            </Questionnaire.Item>
          ))}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-primary/15 pt-3">
            <Questionnaire.Previous className="inline-flex h-8 items-center gap-1 border bg-background px-2.5 text-xs hover:bg-muted disabled:opacity-50">
              <ArrowLeft className="size-3.5" /> Anterior
            </Questionnaire.Previous>
            <div className="flex flex-wrap justify-end gap-2">
              <Questionnaire.Skip className="inline-flex h-8 items-center border bg-background px-2.5 text-xs hover:bg-muted disabled:opacity-50">
                Pular
              </Questionnaire.Skip>
              <Questionnaire.Next className="inline-flex h-8 items-center gap-1 border bg-background px-2.5 text-xs hover:bg-muted disabled:opacity-50">
                Próxima <ArrowRight className="size-3.5" />
              </Questionnaire.Next>
              <Questionnaire.Submit className="inline-flex h-8 items-center gap-1.5 border border-primary bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50">
                <Send className="size-3.5" /> Responder e continuar
              </Questionnaire.Submit>
            </div>
          </div>
        </Questionnaire.Root>
      )}
    </section>
  );
}
