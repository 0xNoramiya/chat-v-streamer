export function Owl({ talking = false }: { talking?: boolean }) {
  return (
    <svg
      className={`owl ${talking ? 'talking' : ''}`}
      viewBox="0 0 320 320"
      role="img"
      aria-label="Judge Docket, an original owl in a judge's wig"
    >
      <defs>
        <linearGradient id="robe" x2="1" y2="1">
          <stop stopColor="#263d3c" />
          <stop offset="1" stopColor="#102322" />
        </linearGradient>
      </defs>
      <path d="M60 320 Q48 202 109 189 L211 189 Q272 205 260 320" fill="url(#robe)" />
      <path d="M139 217 L160 241 L181 217 L190 300 L130 300Z" fill="#f4e8cd" />
      <path
        d="M81 177 Q46 102 83 56 Q160 11 237 56 Q272 102 239 177 L218 221 Q160 255 102 221Z"
        fill="#997244"
      />
      <path d="M85 102 L113 47 L155 85 L207 47 L239 102" fill="#bb965d" />
      <path
        d="M81 128 Q82 76 155 101 L160 132 L166 101 Q238 77 239 128 Q242 184 191 195 L160 172 L128 195 Q78 184 81 128"
        fill="#eadcb7"
      />
      <g fill="#182322">
        <circle cx="120" cy="135" r="18" />
        <circle cx="202" cy="135" r="18" />
      </g>
      <g fill="#faf4e7">
        <circle cx="125" cy="130" r="5" />
        <circle cx="207" cy="130" r="5" />
      </g>
      <path d="M146 159 L175 159 L160 182Z" fill="#eab756" className="beak" />
      <path
        d="M72 131 Q40 84 66 53 Q55 34 87 32 Q106 4 136 21 Q162 1 185 21 Q218 5 237 35 Q270 32 254 59 Q280 94 247 133 L235 89 Q160 59 85 91Z"
        fill="#f1e9db"
        stroke="#c9bda6"
        strokeWidth="4"
      />
      <g fill="none" stroke="#c9bda6" strokeWidth="4">
        <path d="M65 61 Q102 76 91 43 M112 26 Q99 58 139 55 M156 23 Q145 53 176 54 M202 26 Q186 59 221 62 M237 47 Q225 76 251 80" />
        <path d="M71 94 Q51 113 75 130 M248 96 Q270 117 245 139" />
      </g>
      <path
        d="M87 118 L142 126 M180 126 L234 118"
        stroke="#997244"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path d="M40 315 L280 315" stroke="#b38a50" strokeWidth="10" />
    </svg>
  );
}
