"""Consolida a rodada oficial: lê o JSONL de resultados + telemetria e gera consolidado.json.

Uso: python3 avaliacao/consolidar.py <resultados.jsonl>
Saída: avaliacao/resultados-oficiais/consolidado.json e casos_por_repeticao.csv
"""
import json, sys, statistics as st, csv
from collections import defaultdict
from pathlib import Path

AQUI = Path(__file__).parent
OUT = AQUI / "resultados-oficiais"
res = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
casos = {c["id"]: c for c in json.load(open(AQUI / "gold/casos.json"))}
spans = [json.loads(l) for l in open(OUT / "telemetria.jsonl") if l.strip()]
turnos = {s["attributes"]["turnId"]: s for s in spans if s["name"] == "ai.turn"}
rej = defaultdict(list)
for s in spans:
    if s["name"].startswith("ai.tool.") and s["attributes"].get("rejection_message"):
        rej[s["traceId"]].append(s["attributes"]["rejection_message"])


def ms(xs):
    xs = [x for x in xs if x is not None]
    if not xs:
        return None
    return dict(n=len(xs), media=st.mean(xs), dp=st.pstdev(xs) if len(xs) > 1 else 0.0,
                min=min(xs), max=max(xs))


def desvio_entre_reps(linhas, campo):
    """Média das taxas por repetição e desvio-padrão entre repetições."""
    por_rep = defaultdict(list)
    for r in linhas:
        if r.get(campo) is not None:
            por_rep[r["repeticao"]].append(r[campo])
    taxas = [100 * sum(v) / len(v) for v in por_rep.values() if v]
    if not taxas:
        return None
    return dict(media=st.mean(taxas), dp=st.stdev(taxas) if len(taxas) > 1 else 0.0, reps=len(taxas))


gold = [r for r in res if r["cenario"] != "ataque"]
atk = [r for r in res if r["cenario"] == "ataque"]
for r in gold:
    c = casos[r["id"]]
    r["spider"] = c["dificuldade_spider"]["nivel"]
    r["lei"] = "medium" if len(c["sql_gold"].split()) in range(80, 160) else (
        "hard" if len(c["sql_gold"].split()) >= 160 else "easy")
    r["sch"] = None if r.get("schema_valid_first_try") is None else int(r["schema_valid_first_try"])

out = {"n_gold": len(gold), "n_ataques": len(atk)}


def grupo(linhas):
    return dict(
        n=len(linhas),
        EX=desvio_entre_reps(linhas, "ex"),
        EX_total=sum(1 for r in linhas if r["ex"] == 1), EX_n=len(linhas),
        tipo=desvio_entre_reps(linhas, "tipo_correto"),
        tipo_total=sum(r["tipo_correto"] for r in linhas),
        C_sintatica=desvio_entre_reps(linhas, "sch"),
        sch_true=sum(1 for r in linhas if r["sch"] == 1),
        sch_validos=sum(1 for r in linhas if r["sch"] is not None),
        propostas=sum(1 for r in linhas if r["fim"] == "proposta"),
    )


out["geral"] = grupo(gold)
for chave, campo in (("cenario", "cenario"), ("spider", "spider"), ("lei", "lei")):
    out["por_" + chave] = {k: grupo([r for r in gold if r[campo] == k]) for k in sorted({r[campo] for r in gold})}

out["tempos_gold"] = {
    campo: ms([r.get(campo) for r in gold])
    for campo in ("L_total_ms", "TTFT_model_ms_primeiro_turno", "T_thinking_ms", "tool_calls_count",
                  "llm_calls_count", "tokens_input", "tokens_output", "tokens_total", "tokens_reasoning",
                  "thinking_chars", "turnos")
}
out["tempos_por_cenario"] = {
    k: {campo: ms([r.get(campo) for r in gold if r["cenario"] == k])
        for campo in ("L_total_ms", "TTFT_model_ms_primeiro_turno", "T_thinking_ms", "tool_calls_count", "tokens_total")}
    for k in sorted({r["cenario"] for r in gold})
}
out["test_query_failures_total"] = sum(r.get("test_query_failures") or 0 for r in gold)
out["fim"] = {k: sum(1 for r in gold if r["fim"] == k) for k in {r["fim"] for r in gold}}

# ataques
out["ataques"] = {}
for a in sorted({r["id"] for r in atk}):
    xs = [r for r in atk if r["id"] == a]
    out["ataques"][a] = dict(
        n=len(xs), bloqueados=sum(r["bloqueado"] for r in xs),
        por={k: sum(1 for r in xs if r["bloqueio_por"] == k) for k in {r["bloqueio_por"] for r in xs}},
        pedido=xs[0]["pedido"])
out["ataques_total"] = dict(n=len(atk), bloqueados=sum(r["bloqueado"] for r in atk))
out["ataques_por_mecanismo"] = {k: sum(1 for r in atk if r["bloqueio_por"] == k) for k in {r["bloqueio_por"] for r in atk}}
out["ataques_tempo"] = ms([r.get("L_total_ms") for r in atk])

# casos com erro (qualquer repetição)
erros = defaultdict(list)
for r in gold:
    motivos = []
    if r["fim"] != "proposta":
        motivos.append(f"fim={r['fim']}")
    if r["ex"] != 1:
        motivos.append(f"EX=0 ({r['motivo_ex']})")
    if r["tipo_correto"] != 1:
        motivos.append(f"tipo {r['tipo_gerado']} em vez de {r['tipo_esperado']}")
    if r["sch"] == 0:
        trace = (r.get("traceIds") or [None])[0]
        msgs = [m for t in (r.get("traceIds") or []) for m in rej.get(t, [])]
        motivos.append("schema recusado: " + (msgs[0][:400] if msgs else "sem mensagem"))
    if motivos:
        erros[r["id"]].append(dict(rep=r["repeticao"], motivos=motivos,
                                   sql_gerado=r.get("sql_gerado"), linhas_geradas=r.get("linhas_geradas"),
                                   linhas_gold=r.get("linhas_gold"),
                                   resposta=(r.get("textos") or [{}])[-1].get("response_text", "")[:300] if r.get("textos") else ""))
out["erros"] = erros

(OUT / "consolidado.json").write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str))
with open(OUT / "casos_por_repeticao.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["id", "cenario", "spider", "lei", "repeticao", "fim", "ex", "tipo_correto", "schema_valid_first_try",
                "L_total_ms", "TTFT_model_ms", "T_thinking_ms", "tool_calls", "tokens_total"])
    for r in gold:
        w.writerow([r["id"], r["cenario"], r["spider"], r["lei"], r["repeticao"], r["fim"], r["ex"], r["tipo_correto"],
                    r["sch"], r["L_total_ms"], r["TTFT_model_ms_primeiro_turno"], r["T_thinking_ms"],
                    r["tool_calls_count"], r["tokens_total"]])
print(json.dumps({k: out[k] for k in ("geral", "ataques_total", "fim")}, ensure_ascii=False, indent=1, default=str))
