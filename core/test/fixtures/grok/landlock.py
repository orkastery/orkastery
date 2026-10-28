"""RM-067 (F4c, D11): confina um comando como o perfil `workspace` do `grok` confina a escrita.

O guia de sandbox do `grok` (G7 e G17 da RM-067) diz que o `workspace` le em qualquer lugar e so escreve no cwd, na casa
do `grok` e nas pastas temporarias, e que os filhos herdam a restricao de arquivo. Este lancador faz o mesmo com o Landlock
do Linux, para o `grok` falso dos testes: a leitura e a execucao ficam livres, e a escrita so vale nas pastas do arquivo
dado (uma por linha) e em `/dev/null`. A rede fica livre, como no `workspace`. Sem Landlock no kernel, sai 97 sem rodar
nada; com erro ao montar a regra, sai 98.

    python3 -I landlock.py <arquivo com as pastas> <comando> [argumentos...]
"""
import ctypes
import os
import struct
import sys

# As tres chamadas do Landlock tem os mesmos numeros em x86_64 e aarch64.
SYS_CREATE_RULESET, SYS_ADD_RULE, SYS_RESTRICT_SELF = 444, 445, 446
CREATE_RULESET_VERSION = 1
RULE_PATH_BENEATH = 1
PR_SET_NO_NEW_PRIVS = 38

WRITE_FILE = 1 << 1
# Escrever, apagar pasta e arquivo, criar char, pasta, arquivo, socket, fifo, block e link.
ESCRITA_ABI1 = WRITE_FILE | (1 << 4) | (1 << 5) | (1 << 6) | (1 << 7) | (1 << 8) | (1 << 9) | (1 << 10) | (1 << 11) | (1 << 12)
REFER, TRUNCATE, IOCTL_DEV = 1 << 13, 1 << 14, 1 << 15


def main():
    if len(sys.argv) < 3:
        print('uso: python3 -I landlock.py <arquivo com as pastas> <comando> [argumentos...]', file=sys.stderr)
        return 2
    libc = ctypes.CDLL(None, use_errno=True)
    libc.syscall.restype = ctypes.c_long
    abi = libc.syscall(SYS_CREATE_RULESET, None, ctypes.c_size_t(0), ctypes.c_uint32(CREATE_RULESET_VERSION))
    if abi < 1:
        print('landlock: indisponivel no kernel', file=sys.stderr)
        return 97
    escrita = ESCRITA_ABI1 | (REFER if abi >= 2 else 0) | (TRUNCATE if abi >= 3 else 0) | (IOCTL_DEV if abi >= 5 else 0)
    # Num arquivo, so cabem os direitos de arquivo.
    de_arquivo = WRITE_FILE | (TRUNCATE if abi >= 3 else 0) | (IOCTL_DEV if abi >= 5 else 0)
    atributos = struct.pack('=Q', escrita)
    ruleset = libc.syscall(SYS_CREATE_RULESET, ctypes.create_string_buffer(atributos, len(atributos)),
                           ctypes.c_size_t(len(atributos)), ctypes.c_uint32(0))
    if ruleset < 0:
        print('landlock: ruleset recusado, errno %d' % ctypes.get_errno(), file=sys.stderr)
        return 98
    with open(sys.argv[1], encoding='utf-8') as lista:
        pastas = [linha.strip() for linha in lista if linha.strip()]
    for caminho in pastas + ['/dev/null']:
        fd = os.open(caminho, os.O_PATH | os.O_CLOEXEC)
        try:
            direitos = escrita if os.path.isdir(caminho) else de_arquivo
            regra = struct.pack('=Qi', direitos, fd)
            if libc.syscall(SYS_ADD_RULE, ctypes.c_int(ruleset), ctypes.c_int(RULE_PATH_BENEATH),
                            ctypes.create_string_buffer(regra, len(regra)), ctypes.c_uint32(0)) != 0:
                print('landlock: regra recusada, errno %d' % ctypes.get_errno(), file=sys.stderr)
                return 98
        finally:
            os.close(fd)
    if libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
        print('landlock: no_new_privs recusado', file=sys.stderr)
        return 98
    if libc.syscall(SYS_RESTRICT_SELF, ctypes.c_int(ruleset), ctypes.c_uint32(0)) != 0:
        print('landlock: restricao recusada, errno %d' % ctypes.get_errno(), file=sys.stderr)
        return 98
    os.close(ruleset)
    os.execv(sys.argv[2], sys.argv[2:])
    return 99


if __name__ == '__main__':
    sys.exit(main())
