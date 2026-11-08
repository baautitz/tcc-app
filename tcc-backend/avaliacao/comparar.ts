/** Comparação de resultados SQL para a métrica EX (execução), sem ordem de linhas quando o pedido não exige. */

type Linha = Record<string, unknown>;

const ISO_DATA = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:[T ].*)?$/;
const MES_BR = /^(\d{2})\/(\d{4})$/;
const DATA_BR = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const NUMERO = /^-?\d+(?:\.\d+)?$/;

/** Normaliza um valor para comparação: números a 2 casas, datas como AAAA-MM-DD, texto aparado. */
export function normalizarValor(valor: unknown): string {
  if (valor === null || valor === undefined) return "<nulo>";
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === "bigint") return String(valor);
  if (typeof valor === "number") return arredondar(valor);
  if (typeof valor === "boolean") return valor ? "true" : "false";
  const texto = String(valor).trim();
  if (NUMERO.test(texto) && texto.length <= 18)
    return arredondar(Number(texto));
  const mesBr = MES_BR.exec(texto);
  if (mesBr) return `${mesBr[2]}-${mesBr[1]}-01`;
  const dataBr = DATA_BR.exec(texto);
  if (dataBr) return `${dataBr[3]}-${dataBr[2]}-${dataBr[1]}`;
  const data = ISO_DATA.exec(texto);
  if (data) return `${data[1]}-${data[2]}-${data[3] ?? "01"}`;
  return texto;
}

function arredondar(numero: number): string {
  return (Math.round(numero * 100) / 100).toFixed(2);
}

export interface ResultadoComparacao {
  igual: boolean;
  motivo?: string;
}

/**
 * Compara só `colunasEssenciais` do gold. Os nomes das colunas geradas podem ser outros:
 * cada coluna essencial é casada com a coluna gerada de mesmos valores.
 */
export function compararResultados(
  gold: Linha[],
  gerado: Linha[],
  colunasEssenciais: string[],
  ordenado: boolean,
): ResultadoComparacao {
  if (gold.length !== gerado.length)
    return {
      igual: false,
      motivo: `número de linhas diferente (gold ${gold.length}, gerado ${gerado.length})`,
    };
  const colunasGeradas = gerado[0] ? Object.keys(gerado[0]) : [];
  const valores = (linhas: Linha[], coluna: string) =>
    linhas.map((linha) => normalizarValor(linha[coluna]));
  const assinatura = (lista: string[]) => [...lista].sort().join("\u0001");
  const usadas = new Set<string>();
  const mapa: Array<[string, string]> = [];
  for (const essencial of colunasEssenciais) {
    const alvo = assinatura(valores(gold, essencial));
    const par = colunasGeradas.find(
      (candidata) =>
        !usadas.has(candidata) &&
        assinatura(valores(gerado, candidata)) === alvo,
    );
    if (!par)
      return {
        igual: false,
        motivo: `nenhuma coluna gerada tem os valores de '${essencial}'`,
      };
    usadas.add(par);
    mapa.push([essencial, par]);
  }
  const tuplas = (linhas: Linha[], lado: 0 | 1) =>
    linhas.map((linha) =>
      mapa.map((par) => normalizarValor(linha[par[lado]])).join("\u0001"),
    );
  const tuplasGold = tuplas(gold, 0);
  const tuplasGeradas = tuplas(gerado, 1);
  const esperado = ordenado ? tuplasGold : [...tuplasGold].sort();
  const obtido = ordenado ? tuplasGeradas : [...tuplasGeradas].sort();
  const diferente = esperado.findIndex((tupla, i) => tupla !== obtido[i]);
  return diferente === -1
    ? { igual: true }
    : {
        igual: false,
        motivo: `linhas diferem (primeira divergência na posição ${diferente})`,
      };
}
