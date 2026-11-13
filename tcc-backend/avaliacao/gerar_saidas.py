"""Gera quadros LaTeX e gráficos a partir de resultados-oficiais/consolidado.json e l_dashboard_r_payload.json.

Uso: python3 avaliacao/gerar_saidas.py <pasta-do-modelo-latex>
"""
import json, sys, csv
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

AQUI = Path(__file__).parent / "resultados-oficiais"
MODELO = Path(sys.argv[1])
TAB = MODELO / "Tabelas"
IMG = MODELO / "Imagens" / "resultados"
TAB.mkdir(exist_ok=True, parents=True)
IMG.mkdir(exist_ok=True, parents=True)
c = json.load(open(AQUI / "consolidado.json"))
ld = json.load(open(AQUI / "l_dashboard_r_payload.json"))

NOMES = {"kpi": "KPIs isolados", "temporal": "Agrupamentos temporais", "juncoes": "Junções múltiplas", "lista": "Listas tabulares"}
CORES = ["#2a78d6", "#eb6834", "#1baf7a"]


def pt(x, d=1):
    return f"{x:.{d}f}".replace(".", ",")


def pct(m):
    if not m:
        return "--"
    return f"{pt(m['media'])} $\\pm$ {pt(m['dp'])}"


def quadro(nome, legenda, label, colspec, cab, linhas, nota=None, fonte="Elaborado pelo autor (2026)."):
    corpo = "\n".join("\t\t" + " & ".join(str(x) for x in l) + " \\\\\n\t\t\\hline" for l in linhas)
    nota_tex = f"\n\t\\par\\vspace{{2pt}}\n\t\\small {nota}\\par" if nota else ""
    (TAB / f"{nome}.tex").write_text(
        "% Gerado por tcc-backend/avaliacao/gerar_saidas.py (nao editar a mao)\n"
        "\\begin{quadro}[H]\n\t\\centering\n"
        f"\t\\caption{{{legenda}}}\n\t\\label{{{label}}}\n"
        "\t\\begin{adjustbox}{max width=\\textwidth}\n\t\\small\n"
        f"\t\\begin{{tabular}}{{{colspec}}}\n\t\t\\hline\n\t\t" + " & ".join(f"\\textbf{{{x}}}" for x in cab)
        + " \\\\\n\t\t\\hline\n" + corpo + "\n\t\\end{tabular}\n\t\\end{adjustbox}" + nota_tex
        + f"\n\t\\fonte{{{fonte}}}\n\\end{{quadro}}\n")


def lin_grupo(rotulo, g):
    return [rotulo, g["n"], pct(g["EX"]), pct(g["tipo"]), pct(g["C_sintatica"]), f"{g['sch_true']}/{g['sch_validos']}"]


cab1 = ["Grupo", "Execuções", "EX (\\%)", "Tipo correto (\\%)", "$C_{\\text{sintática}}$ (\\%)", "Esquema válido na 1ª tentativa"]
spec1 = "|l|c|c|c|c|c|"
nota1 = "Valores: média $\\pm$ desvio padrão entre as três repetições; cada repetição percorre o conjunto inteiro."
linhas = [lin_grupo(NOMES[k], c["por_cenario"][k]) for k in ("kpi", "temporal", "juncoes", "lista")]
linhas.append(lin_grupo("\\textbf{Geral}", c["geral"]))
quadro("quadro_resultados_cenarios", "Resultados do agente por cenário analítico", "qua:res-cenarios", spec1, cab1, linhas, nota1)

linhas = []
for k, rot in (("easy", "Fácil"), ("medium", "Médio"), ("hard", "Difícil"), ("extra", "Extra")):
    if k in c["por_lei"]:
        linhas.append(lin_grupo(f"Lei et al.: {rot}", c["por_lei"][k]))
for k, rot in (("easy", "Fácil"), ("medium", "Médio"), ("hard", "Difícil"), ("extra", "Extra difícil")):
    if k in c["por_spider"]:
        linhas.append(lin_grupo(f"Spider: {rot}", c["por_spider"][k]))
quadro("quadro_resultados_dificuldade", "Resultados do agente por nível de dificuldade do SQL de referência", "qua:res-dificuldade", spec1, cab1, linhas, nota1)

# tempos
T = c["tempos_gold"]
def lt(rot, k, esc=1.0, d=1):
    m = T[k]
    return [rot, pt(m["media"] / esc, d), pt(m["dp"] / esc, d), pt(m["min"] / esc, d), pt(m["max"] / esc, d)]
linhas = [lt("$L_{\\text{total}}$ (s)", "L_total_ms", 1000), lt("TTFT do modelo (s)", "TTFT_model_ms_primeiro_turno", 1000),
          lt("$T_{\\text{thinking}}$ (s)", "T_thinking_ms", 1000), lt("Chamadas de ferramenta", "tool_calls_count", 1, 1),
          lt("Chamadas ao modelo", "llm_calls_count", 1, 1), lt("Tokens totais", "tokens_total", 1, 0),
          lt("Tokens de saída", "tokens_output", 1, 0)]
quadro("quadro_resultados_tempos", "Tempo e custo do agente por pedido", "qua:res-tempos", "|l|c|c|c|c|",
       ["Métrica", "Média", "Desvio padrão", "Mínimo", "Máximo"], linhas,
       f"Estatística sobre {T['L_total_ms']['n']} execuções do conjunto gold (28 casos $\\times$ 3 repetições); $L_{{\\text{{total}}}}$ inclui as pausas automáticas para aprovação de query.")

# ataques
linhas = []
for a, v in c["ataques"].items():
    por = ", ".join(f"{k.replace('_', ' ')}: {n}" for k, n in sorted(v["por"].items()))
    linhas.append([a, f"{v['bloqueados']}/{v['n']}", por])
t = c["ataques_total"]
linhas.append(["\\textbf{Total}", f"\\textbf{{{t['bloqueados']}/{t['n']}}}", ""])
quadro("quadro_resultados_seguranca", "Bloqueio de ataques de injeção de prompt para SQL", "qua:res-seguranca", "|l|c|l|",
       ["Ataque", "Bloqueados/total", "Mecanismo que impediu o SQL proibido"], linhas)

# L_dashboard / R_payload
def kb(b):
    return pt(b / 1024, 1)
comp = [x for x in ld if x["cenario"].startswith("composto") or x["cenario"] == "volumosa"]
linhas = [[x["item"].replace("_", "\\_"), x["queries"], x["L_dashboard_frio_ms"], x["L_dashboard_quente_media_ms"],
           kb(x["bytes_layout"]), kb(x["bytes_dados"]), pt(x["R_payload_pct"], 2)] for x in comp]
indiv = [x for x in ld if not x["cenario"].startswith("composto") and x["cenario"] != "volumosa"]
if indiv:
    import statistics as st
    linhas.append([f"28 casos gold (1 componente cada), média", 1,
                   round(st.mean(x["L_dashboard_frio_ms"] for x in indiv)),
                   round(st.mean(x["L_dashboard_quente_media_ms"] for x in indiv)),
                   kb(st.mean(x["bytes_layout"] for x in indiv)), kb(st.mean(x["bytes_dados"] for x in indiv)),
                   pt(st.mean(x["R_payload_pct"] for x in indiv), 2)])
quadro("quadro_resultados_dashboard", "Latência de carga do dashboard salvo ($L_{\\text{dashboard}}$) e redução de carga útil ($R_{\\text{payload}}$)",
       "qua:res-dashboard", "|l|c|c|c|c|c|c|",
       ["Dashboard", "Queries", "$L$ fria (ms)", "$L$ quente (ms)", "Layout (KiB)", "Dados (KiB)", "$R_{\\text{payload}}$ (\\%)"], linhas,
       "$L_{\\text{dashboard}}$: tempo até o último byte do layout e de todas as queries, medido por cliente HTTP (sem renderização do navegador); "
       "``quente'' é a média de 10 cargas consecutivas.")

# ---------------------------------------------------------------- gráficos
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.edgecolor": "#52514e", "axes.labelcolor": "#0b0b0b", "xtick.color": "#0b0b0b", "ytick.color": "#0b0b0b"})
import numpy as np

fig, ax = plt.subplots(figsize=(8, 4.4))
ks = ["kpi", "temporal", "juncoes", "lista"]
x = np.arange(len(ks) + 1)
w = 0.26
RÓTULO_QUEBRADO = {"kpi": "KPIs\nisolados", "temporal": "Agrupamentos\ntemporais", "juncoes": "Junções\nmúltiplas", "lista": "Listas\ntabulares"}
rot = [RÓTULO_QUEBRADO[k] for k in ks] + ["Geral"]
grupos = [c["por_cenario"][k] for k in ks] + [c["geral"]]
for i, (campo, nome) in enumerate((("EX", "EX"), ("tipo", "Tipo correto"), ("C_sintatica", "$C_{sintática}$"))):
    vals = [g[campo]["media"] if g[campo] else 0 for g in grupos]
    erro = [g[campo]["dp"] if g[campo] else 0 for g in grupos]
    b = ax.bar(x + (i - 1) * w, vals, w - 0.03, yerr=erro, capsize=2, color=CORES[i], label=nome, error_kw={"lw": 1, "ecolor": "#52514e"})
    for xi, v, e in zip(x + (i - 1) * w, vals, erro):
        ax.text(xi, min(v + e, 100) + 2, f"{v:.0f}", ha="center", fontsize=8, color="#0b0b0b")
ax.set_xticks(x, rot)
ax.set_ylim(0, 125)
ax.set_ylabel("%")
ax.legend(frameon=False, ncol=3, loc="upper center", bbox_to_anchor=(0.5, 1.12))
ax.yaxis.grid(True, color="#e3e2de", lw=0.6); ax.set_axisbelow(True)
fig.tight_layout(); fig.savefig(IMG / "grafico_acerto_por_cenario.png", dpi=200); fig.savefig(IMG / "grafico_acerto_por_cenario.pdf"); plt.close(fig)

# EX por dificuldade Spider
fig, ax = plt.subplots(figsize=(6, 3.6))
ordem = [k for k in ("easy", "medium", "hard", "extra") if k in c["por_spider"]]
vals = [c["por_spider"][k]["EX"]["media"] for k in ordem]
erro = [c["por_spider"][k]["EX"]["dp"] for k in ordem]
ns = [c["por_spider"][k]["n"] for k in ordem]
ax.bar(range(len(ordem)), vals, 0.55, yerr=erro, capsize=3, color=CORES[0], error_kw={"lw": 1, "ecolor": "#52514e"})
for i, (v, n) in enumerate(zip(vals, ns)):
    ax.text(i, v + 4, f"{v:.0f}% (n={n})", ha="center", fontsize=9)
ax.set_xticks(range(len(ordem)), [{"easy": "Fácil", "medium": "Médio", "hard": "Difícil", "extra": "Extra"}[k] for k in ordem])
ax.set_ylim(0, 118); ax.set_ylabel("EX (%)"); ax.set_xlabel("Dificuldade estrutural (Spider 1.0)")
ax.yaxis.grid(True, color="#e3e2de", lw=0.6); ax.set_axisbelow(True)
fig.tight_layout(); fig.savefig(IMG / "grafico_ex_por_dificuldade.png", dpi=200); fig.savefig(IMG / "grafico_ex_por_dificuldade.pdf"); plt.close(fig)

# L_total por cenário (box)
casos_csv = list(csv.DictReader(open(AQUI / "casos_por_repeticao.csv")))
fig, ax = plt.subplots(figsize=(7, 3.8))
dados = [[float(r["L_total_ms"]) / 1000 for r in casos_csv if r["cenario"] == k] for k in ks]
bp = ax.boxplot(dados, tick_labels=[RÓTULO_QUEBRADO[k] for k in ks], patch_artist=True, medianprops={"color": "#0b0b0b"}, flierprops={"markersize": 3})
for p in bp["boxes"]:
    p.set_facecolor("#9cc3f0"); p.set_edgecolor("#2a78d6")
ax.set_ylabel("$L_{total}$ por pedido (s)")
ax.yaxis.grid(True, color="#e3e2de", lw=0.6); ax.set_axisbelow(True)
fig.tight_layout(); fig.savefig(IMG / "grafico_latencia_agente.png", dpi=200); fig.savefig(IMG / "grafico_latencia_agente.pdf"); plt.close(fig)

# L_dashboard (quente e fria) + meta 3 s
fig, ax = plt.subplots(figsize=(7.5, 4))
itens = comp
x = np.arange(len(itens))
ax.bar(x - 0.2, [i["L_dashboard_frio_ms"] / 1000 for i in itens], 0.38, color=CORES[1], label="Carga fria")
ax.bar(x + 0.2, [i["L_dashboard_quente_media_ms"] / 1000 for i in itens], 0.38, color=CORES[0], label="Carga quente (média de 10)")
ax.axhline(3, color="#0b0b0b", lw=1, ls="--"); ax.text(len(itens) - 0.5, 3.05, "meta: 3 s", ha="right", fontsize=8)
ax.set_xticks(x, [i["item"].replace("composto-", "").replace("volumosa-", "vol. ") for i in itens], rotation=20)
ax.set_ylabel("$L_{dashboard}$ (s)")
ax.legend(frameon=False)
ax.yaxis.grid(True, color="#e3e2de", lw=0.6); ax.set_axisbelow(True)
fig.tight_layout(); fig.savefig(IMG / "grafico_latencia_dashboard.png", dpi=200); fig.savefig(IMG / "grafico_latencia_dashboard.pdf"); plt.close(fig)
print("ok")
